/**
 * Nightjar playback engine (improved).
 *
 * Changes from the original (same public API, plus a few additions):
 * 1. Crossfade keeps working with the screen off. The original only checked for
 *    the hand-off inside requestAnimationFrame, which browsers pause when the tab
 *    is hidden or the phone is locked. The check now also runs on the audio
 *    element's `timeupdate` event and on a light timer while hidden.
 * 2. Manual skips use a short fade (max 0.6 s) instead of the full crossfade, so
 *    pressing Next feels instant even with a 12 s crossfade set.
 * 3. Lock-screen and headset controls through the Media Session API:
 *    setNowPlaying() for title/artist/artwork, onNext/onPrevious hooks, and
 *    position updates so the lock-screen scrubber is accurate.
 * 4. Seeking or pausing in the middle of a crossfade now settles both decks, so
 *    the old track can't keep playing quietly underneath.
 * 5. stop() also silences both decks' gains and clears the Media Session.
 */

export type EngineSnap = {
  playing: boolean;
  trackId: string | null;
  currentTime: number;
  duration: number;
  error: string | null;
  sampleRate: number | null;
};

export type NowPlaying = {
  title: string;
  artist?: string;
  album?: string;
  /** Absolute or root-relative URL; a blob: URL also works. */
  artwork?: string | null;
};

type Next = { id: string; url: string };

type Deck = {
  el: HTMLAudioElement;
  gain: GainNode | null;
  source: MediaElementAudioSourceNode | null;
};

const BANDS: { type: BiquadFilterType; f: number; q: number }[] = [
  { type: "lowshelf", f: 80, q: 0.7 },
  { type: "peaking", f: 250, q: 0.9 },
  { type: "peaking", f: 1000, q: 1 },
  { type: "peaking", f: 4000, q: 0.9 },
  { type: "highshelf", f: 10000, q: 0.7 },
];

/** Longest fade used when the listener skips by hand. */
const MANUAL_SKIP_FADE = 0.6;
/** How often the hand-off is checked while the page is hidden (ms). */
const HIDDEN_TICK_MS = 250;

const hasWindow = typeof window !== "undefined";
const hasMediaSession = () => typeof navigator !== "undefined" && "mediaSession" in navigator;

class NightjarEngine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private decks: Deck[] = [];
  private live = 0;
  private token = 0;
  private arming = false;
  private armGen = 0;
  private looping = false;
  private ignoreEnd = new WeakSet<HTMLAudioElement>();
  private volume = 0.82;
  private fade = 0;
  private eqGains = [0, 0, 0, 0, 0];
  private eqOn = false;
  private playing = false;
  private trackId: string | null = null;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private fadeTimer: number | null = null;
  private lastPositionPush = 0;

  prefetch: (() => Next | null) | null = null;
  onEnded: (() => void) | null = null;
  onError: ((id: string, message: string) => void) | null = null;
  /** Called by lock-screen / headset "next track". Wire this to the queue. */
  onNext: (() => void) | null = null;
  /** Called by lock-screen / headset "previous track". Wire this to the queue. */
  onPrevious: (() => void) | null = null;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  snapshot(): EngineSnap {
    const el = this.decks[this.live]?.el;
    const duration = el && Number.isFinite(el.duration) ? el.duration : 0;
    return {
      playing: this.playing,
      trackId: this.trackId,
      currentTime: el?.currentTime ?? 0,
      duration,
      error: this.error,
      sampleRate: this.ctx?.sampleRate ?? null,
    };
  }

  getAnalyser() {
    return this.analyser;
  }

  isHandingOff() {
    return this.arming;
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.volume;
    this.emit();
  }

  setFade(seconds: number) {
    this.fade = Math.max(0, Math.min(12, seconds));
  }

  setEq(gains: number[], on: boolean) {
    this.eqGains = gains.slice(0, 5);
    this.eqOn = on;
    this.filters.forEach((filter, i) => {
      filter.gain.value = on ? (this.eqGains[i] ?? 0) : 0;
    });
  }

  /** Show title, artist and artwork on the lock screen and in system media controls. */
  setNowPlaying(info: NowPlaying | null) {
    if (!hasMediaSession()) return;
    if (!info) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const artwork = info.artwork
      ? [96, 192, 512].map((size) => ({ src: info.artwork as string, sizes: `${size}x${size}` }))
      : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: info.title,
        artist: info.artist ?? "",
        album: info.album ?? "",
        artwork,
      });
    } catch {
      /* MediaMetadata is missing in some older browsers */
    }
  }

  private boot() {
    if (this.ctx || !hasWindow) return;
    const ctx = new AudioContext();
    const bus = ctx.createGain();
    const filters = BANDS.map((band) => {
      const filter = ctx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.f;
      filter.Q.value = band.q;
      filter.gain.value = 0;
      return filter;
    });
    let node: AudioNode = bus;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    const master = ctx.createGain();
    master.gain.value = this.volume;
    node.connect(master);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.82;
    master.connect(analyser);
    analyser.connect(ctx.destination);
    this.ctx = ctx;
    this.bus = bus;
    this.master = master;
    this.analyser = analyser;
    this.filters = filters;
    this.setEq(this.eqGains, this.eqOn);
    this.decks = [0, 1].map(() => {
      const el = new Audio();
      el.preload = "auto";
      // timeupdate keeps firing (about 4 times a second) while the screen is off,
      // unlike requestAnimationFrame, so the crossfade hand-off still happens.
      el.addEventListener("timeupdate", () => {
        this.maybeHandoff();
        this.pushPosition();
      });
      return { el, gain: null, source: null };
    });
    this.bindMediaSession();
  }

  private bindMediaSession() {
    if (!hasMediaSession()) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported on this browser */
      }
    };
    set("play", () => void this.resume());
    set("pause", () => this.pause());
    set("stop", () => this.stop());
    set("nexttrack", () => this.onNext?.());
    set("previoustrack", () => this.onPrevious?.());
    set("seekto", (details) => {
      if (typeof details.seekTime === "number") this.seek(details.seekTime);
    });
    set("seekbackward", (details) => {
      const el = this.decks[this.live]?.el;
      if (el) this.seek(el.currentTime - (details.seekOffset ?? 10));
    });
    set("seekforward", (details) => {
      const el = this.decks[this.live]?.el;
      if (el) this.seek(el.currentTime + (details.seekOffset ?? 10));
    });
  }

  private pushPosition(force = false) {
    if (!hasMediaSession()) return;
    const now = Date.now();
    if (!force && now - this.lastPositionPush < 1000) return;
    this.lastPositionPush = now;
    const el = this.decks[this.live]?.el;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: el.duration,
        playbackRate: el.playbackRate || 1,
        position: Math.min(el.currentTime, el.duration),
      });
    } catch {
      /* setPositionState is optional */
    }
  }

  private setSessionState() {
    if (!hasMediaSession()) return;
    navigator.mediaSession.playbackState = this.playing ? "playing" : this.trackId ? "paused" : "none";
  }

  private connect(deck: Deck) {
    if (!this.ctx || !this.bus || deck.source) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const source = this.ctx.createMediaElementSource(deck.el);
    source.connect(gain);
    gain.connect(this.bus);
    deck.gain = gain;
    deck.source = source;
  }

  /** UI refresh loop: animation frames when visible, a light timer when hidden. */
  private loop() {
    if (this.looping) return;
    this.looping = true;
    const step = () => {
      this.maybeHandoff();
      this.emit();
      if (!this.playing) {
        this.looping = false;
        return;
      }
      if (typeof document !== "undefined" && document.hidden) {
        window.setTimeout(step, HIDDEN_TICK_MS);
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  private maybeHandoff() {
    if (this.arming || this.fade < 0.2 || !this.playing) return;
    const el = this.decks[this.live]?.el;
    if (!el?.duration || el.paused || el.duration <= this.fade + 0.75) return;
    const remain = el.duration - el.currentTime;
    if (remain > this.fade || remain < 0.08) return;
    const gen = ++this.armGen;
    this.arming = true;
    const nxt = this.prefetch?.();
    if (!nxt?.url) {
      this.arming = false;
      return;
    }
    this.ignoreEnd.add(el);
    // Fade only over the time that's actually left, so a late check (hidden tab)
    // doesn't cut the outgoing track short or overrun its end.
    const fade = Math.max(0.2, Math.min(this.fade, remain));
    void this.startIncoming(nxt, fade).finally(() => {
      if (this.armGen === gen) this.arming = false;
    });
  }

  /** Finish any crossfade in progress: live deck at full level, the other silent and paused. */
  private settle() {
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.decks.forEach((deck, i) => {
      if (!deck.gain) return;
      deck.gain.gain.cancelScheduledValues(now);
      deck.gain.gain.setValueAtTime(i === this.live ? 1 : 0, now);
      if (i !== this.live) deck.el.pause();
    });
  }

  private async startIncoming(next: Next, fade: number) {
    this.boot();
    const my = ++this.token;
    if (!this.ctx) return my;
    try {
      if (this.ctx.state === "suspended") await this.ctx.resume();
    } catch {
      /* resume can reject without a gesture */
    }
    if (my !== this.token) return my;
    if (!next.url) {
      this.fail(next.id, "This file isn’t on the device.");
      return my;
    }
    const outgoing = this.live;
    const canOverlap = Boolean(this.trackId && this.decks[outgoing]?.source);
    const index = canOverlap ? 1 - outgoing : outgoing;
    this.live = index;
    this.trackId = next.id;
    this.error = null;
    const deck = this.decks[index];
    const prev = this.decks[outgoing];
    if (canOverlap && prev?.el) this.ignoreEnd.add(prev.el);
    this.ignoreEnd.delete(deck.el);
    deck.el.onended = null;
    deck.el.pause();
    if (deck.el.src !== next.url) deck.el.src = next.url;
    else deck.el.currentTime = 0;
    this.connect(deck);
    deck.el.onended = () => {
      if (this.ignoreEnd.has(deck.el)) return;
      if (this.live !== index || this.trackId !== next.id) return;
      this.playing = false;
      this.setSessionState();
      this.emit();
      this.onEnded?.();
    };
    deck.el.onerror = () => {
      if (this.trackId !== next.id || this.live !== index) return;
      this.fail(next.id, "This file couldn’t be played in this browser.");
    };
    try {
      await deck.el.play();
    } catch {
      if (my !== this.token) return my;
      this.fail(next.id, "Playback was blocked. Press play once more.");
      return my;
    }
    if (my !== this.token) {
      if (this.live !== index) deck.el.pause();
      return my;
    }
    const now = this.ctx.currentTime;
    const seconds = Math.max(0.02, fade);
    const gain = deck.gain;
    if (gain) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + seconds);
    }
    if (canOverlap && prev?.gain) {
      prev.gain.gain.cancelScheduledValues(now);
      prev.gain.gain.setValueAtTime(prev.gain.gain.value, now);
      prev.gain.gain.linearRampToValueAtTime(0, now + seconds);
      const prevEl = prev.el;
      if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
      this.fadeTimer = window.setTimeout(() => {
        this.fadeTimer = null;
        if (this.live !== outgoing) prevEl.pause();
      }, seconds * 1000 + 40);
    }
    this.playing = true;
    this.setSessionState();
    this.pushPosition(true);
    this.emit();
    this.loop();
    return my;
  }

  private fail(id: string, message: string) {
    this.playing = false;
    this.error = message;
    this.setSessionState();
    this.onError?.(id, message);
    this.emit();
  }

  /**
   * Play a track now. A manual choice uses a short fade (at most 0.6 s) so it
   * feels immediate; automatic hand-offs use the full crossfade setting.
   */
  play(id: string, url: string) {
    this.armGen++;
    this.arming = false;
    const fade = this.fade > 0 && this.playing ? Math.min(this.fade, MANUAL_SKIP_FADE) : 0.02;
    return this.startIncoming({ id, url }, fade);
  }

  async resume() {
    const deck = this.decks[this.live];
    if (!deck?.el.src) return;
    this.boot();
    try {
      if (this.ctx?.state === "suspended") await this.ctx.resume();
    } catch {
      /* needs a user gesture; play() below reports it */
    }
    try {
      await deck.el.play();
      if (deck.gain && this.ctx) {
        const now = this.ctx.currentTime;
        deck.gain.gain.cancelScheduledValues(now);
        deck.gain.gain.setValueAtTime(1, now);
      }
      this.playing = true;
      this.error = null;
      this.setSessionState();
      this.pushPosition(true);
      this.emit();
      this.loop();
    } catch {
      this.fail(this.trackId ?? "", "Playback was blocked. Press play once more.");
    }
  }

  pause() {
    this.settle();
    this.decks[this.live]?.el.pause();
    this.playing = false;
    this.arming = false;
    this.armGen++;
    this.setSessionState();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.resume();
  }

  seek(time: number) {
    const el = this.decks[this.live]?.el;
    if (!el) return;
    this.settle();
    this.ignoreEnd.delete(el);
    this.arming = false;
    this.armGen++;
    const duration = Number.isFinite(el.duration) ? el.duration : time;
    el.currentTime = Math.max(0, Math.min(time, duration));
    this.pushPosition(true);
    this.emit();
  }

  stop() {
    this.token++;
    this.armGen++;
    this.arming = false;
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    const now = this.ctx?.currentTime ?? 0;
    for (const deck of this.decks) {
      deck.el.pause();
      deck.gain?.gain.cancelScheduledValues(now);
      deck.gain?.gain.setValueAtTime(0, now);
    }
    this.playing = false;
    this.trackId = null;
    this.setSessionState();
    this.setNowPlaying(null);
    this.emit();
  }
}

const globalEngine = globalThis as unknown as { __nightjar?: NightjarEngine };

export const engine = globalEngine.__nightjar ?? (globalEngine.__nightjar = new NightjarEngine());
