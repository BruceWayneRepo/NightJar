import { useSyncExternalStore } from "react";
import { CATALOG_TRACKS, collectAlbums } from "./catalog";
import { engine } from "./engine";
import { idbDel, idbGet, idbPut, requestPersistentStorage } from "./idb";
import { glowFromImage, probePlayback, readFileMeta } from "./metadata";
import { dataUrlToBlob, songKeyFor } from "./songkey";
import type { Album, Playlist, RepeatMode, Track, View } from "./types";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type Toast = { id: number; text: string };

export type State = {
  tracks: Track[];
  albums: Album[];
  queue: string[];
  /** The queue order before shuffle, so turning shuffle off restores it. */
  baseQueue: string[];
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  view: View;
  nowPlayingOpen: boolean;
  crossfade: number;
  eqOn: boolean;
  eqGains: number[];
  volume: number;
  playlists: Playlist[];
  toasts: Toast[];
  importing: { done: number; total: number } | null;
  ready: boolean;
};

const SETTINGS_KEY = "nightjar.settings.v1";
const PLAYLISTS_KEY = "nightjar.playlists.v1";
const LIBRARY_KEY = "library:index";

type Settings = Pick<State, "crossfade" | "eqOn" | "eqGains" | "volume" | "shuffle" | "repeat">;

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage full: settings just won't persist */
  }
}

const savedSettings = loadJSON<Settings>(SETTINGS_KEY, {
  crossfade: 0,
  eqOn: false,
  eqGains: [0, 0, 0, 0, 0],
  volume: 0.82,
  shuffle: false,
  repeat: "off",
});

let savedPlaylists: Playlist[] = [];
try {
  const raw = localStorage.getItem(PLAYLISTS_KEY);
  savedPlaylists = raw ? (JSON.parse(raw) as Playlist[]) : [];
} catch {
  savedPlaylists = [];
}

let state: State = {
  tracks: CATALOG_TRACKS,
  albums: collectAlbums(CATALOG_TRACKS),
  queue: [],
  baseQueue: [],
  index: -1,
  view: { name: "listen" },
  nowPlayingOpen: false,
  playlists: savedPlaylists,
  toasts: [],
  importing: null,
  ready: false,
  ...savedSettings,
};

const listeners = new Set<() => void>();

/* ------------------------------------------------------------------ */
/* Sync hooks (filled in by sync.ts when you're signed in)             */
/* ------------------------------------------------------------------ */

export const syncHooks: {
  /** Playlists you changed or deleted on this device. */
  playlistsChanged?: (changed: Playlist[], deletedIds: string[]) => void;
  /** Crossfade / EQ changed on this device. */
  settingsChanged?: (settings: SyncedSettings, updatedAt: number) => void;
  /** Songs added to or removed from this device. */
  tracksChanged?: () => void;
  /** Fetch a song that's in your account but not on this device. */
  downloadCloud?: (track: Track, quiet: boolean) => Promise<Blob | null>;
  /** Called straight from a tap on a song that's only in Drive, so Drive access can be renewed in time. */
  beforeCloudPlay?: () => void;
  /** Is this song saved in your account? (then removing it here keeps it in playlists) */
  inCloud?: (songKey: string) => { driveId: string | null } | null;
} = {};

export type SyncedSettings = Pick<State, "crossfade" | "eqOn" | "eqGains">;
const SETTINGS_TIME_KEY = "nightjar.settingsUpdatedAt";

let applyingRemote = false;
/** Run changes that came from another device without echoing them back. */
export function applyRemote(fn: () => void) {
  applyingRemote = true;
  try {
    fn();
  } finally {
    applyingRemote = false;
  }
}

export function settingsUpdatedAt() {
  return Number(localStorage.getItem(SETTINGS_TIME_KEY) || 0);
}

function set(patch: Partial<State>) {
  const prevPlaylists = state.playlists;
  const prevTrackCount = state.tracks.filter((t) => t.storage !== "cloud").length;
  state = { ...state, ...patch };
  if ("tracks" in patch) state.albums = collectAlbums(state.tracks);
  for (const l of listeners) l();
  if ("crossfade" in patch || "eqOn" in patch || "eqGains" in patch || "volume" in patch || "shuffle" in patch || "repeat" in patch) {
    saveJSON(SETTINGS_KEY, {
      crossfade: state.crossfade,
      eqOn: state.eqOn,
      eqGains: state.eqGains,
      volume: state.volume,
      shuffle: state.shuffle,
      repeat: state.repeat,
    });
  }
  if ("playlists" in patch) saveJSON(PLAYLISTS_KEY, state.playlists);
  if (applyingRemote) return;
  if (("crossfade" in patch || "eqOn" in patch || "eqGains" in patch) && syncHooks.settingsChanged) {
    const now = Date.now();
    saveJSON(SETTINGS_TIME_KEY, now);
    syncHooks.settingsChanged({ crossfade: state.crossfade, eqOn: state.eqOn, eqGains: state.eqGains }, now);
  }
  if ("playlists" in patch && syncHooks.playlistsChanged) {
    const changed = state.playlists.filter((p) => !prevPlaylists.includes(p));
    const ids = new Set(state.playlists.map((p) => p.id));
    const deleted = prevPlaylists.filter((p) => !ids.has(p.id)).map((p) => p.id);
    if (changed.length || deleted.length) syncHooks.playlistsChanged(changed, deleted);
  }
  if ("tracks" in patch && state.tracks.filter((t) => t.storage !== "cloud").length !== prevTrackCount) syncHooks.tracksChanged?.();
}

export function getState() {
  return state;
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
    () => select(state),
  );
}

export function useEngine() {
  return useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => snapCache(),
    () => snapCache(),
  );
}

// useSyncExternalStore needs a stable object between changes.
let lastSnap = engine.snapshot();
function snapCache() {
  const next = engine.snapshot();
  if (
    next.playing !== lastSnap.playing ||
    next.trackId !== lastSnap.trackId ||
    Math.abs(next.currentTime - lastSnap.currentTime) > 0.05 ||
    next.duration !== lastSnap.duration ||
    next.error !== lastSnap.error ||
    next.sampleRate !== lastSnap.sampleRate
  ) {
    lastSnap = next;
  }
  return lastSnap;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let toastId = 0;
export function toast(text: string) {
  const t = { id: ++toastId, text };
  set({ toasts: [...state.toasts, t] });
  window.setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), 3200);
}

export const trackById = (id: string | null | undefined) => (id ? state.tracks.find((t) => t.id === id) : undefined);

export function currentTrack() {
  return trackById(state.queue[state.index]);
}

let navigationReady = false;

function scrollToTop() {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, behavior: "auto" });
  document.getElementById("nj-main")?.scrollTo({ top: 0, behavior: "auto" });
}

/**
 * Keep the browser history aligned with in-app navigation. This makes browser
 * Back and Android's system Back gesture behave like normal app navigation.
 */
export function initNavigation() {
  if (typeof window === "undefined" || navigationReady) return;
  navigationReady = true;
  const current = window.history.state as { nightjarView?: View } | null;
  if (!current?.nightjarView) {
    window.history.replaceState({ ...(current ?? {}), nightjarView: state.view }, "", window.location.href);
  }
  window.addEventListener("popstate", (event) => {
    const previous = (event.state as { nightjarView?: View } | null)?.nightjarView;
    // Settings is a utility destination: Back always returns to the listening
    // home, never to the More hub that happened to contain its entry point.
    const target: View = state.view.name === "settings"
      ? { name: "listen" }
      : previous ?? { name: "listen" };
    window.history.replaceState({ ...(window.history.state ?? {}), nightjarView: target }, "", window.location.href);
    set({ view: target });
    scrollToTop();
  });
}

export function navigate(view: View) {
  if (typeof window !== "undefined") {
    if (!navigationReady) initNavigation();
    const same = JSON.stringify(state.view) === JSON.stringify(view);
    if (!same) window.history.pushState({ nightjarView: view }, "", window.location.href);
  }
  set({ view });
  scrollToTop();
}

/** Explicit in-app Back action for screens that provide their own back control. */
export function navigateBack() {
  if (state.view.name === "settings") {
    const home: View = { name: "listen" };
    if (typeof window !== "undefined") {
      window.history.replaceState({ ...(window.history.state ?? {}), nightjarView: home }, "", window.location.href);
    }
    set({ view: home });
    scrollToTop();
    return;
  }
  if (typeof window !== "undefined" && window.history.state?.nightjarView) {
    window.history.back();
    return;
  }
  navigate({ name: "listen" });
}

export function setNowPlayingOpen(open: boolean) {
  set({ nowPlayingOpen: open });
}

function shuffled<T>(items: T[]) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* Local files: object URLs                                            */
/* ------------------------------------------------------------------ */

const urlCache = new Map<string, string>();
const downloading = new Map<string, Promise<string | null>>();

async function urlFor(track: Track, quiet = false): Promise<string | null> {
  if (track.storage === "catalog") return track.src;
  const cached = urlCache.get(track.id);
  if (cached) return cached;
  if (track.storage === "cloud") {
    if (!downloading.has(track.id)) downloading.set(track.id, downloadToDevice(track, quiet).finally(() => downloading.delete(track.id)));
    return downloading.get(track.id)!;
  }
  const blob = await idbGet(`audio:${track.id}`);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(track.id, url);
  return url;
}

/** Bring a song from your account onto this device; it then plays like any imported song. */
async function downloadToDevice(track: Track, quiet: boolean): Promise<string | null> {
  if (!syncHooks.downloadCloud) return null;
  if (!quiet && track.driveId) toast(`Downloading “${track.title}”…`);
  const blob = await syncHooks.downloadCloud(track, quiet);
  if (!blob) return null;
  await idbPut(`audio:${track.id}`, blob);
  let hasEmbeddedArt = false;
  if (track.artwork?.startsWith("data:")) {
    await idbPut(`art:${track.id}`, await dataUrlToBlob(track.artwork));
    hasEmbeddedArt = true;
  }
  const local: Track = { ...track, storage: "local", bytes: blob.size, hasEmbeddedArt, addedAt: track.addedAt || Date.now() };
  set({ tracks: state.tracks.map((t) => (t.id === track.id ? local : t)) });
  await saveLibraryIndex();
  const url = URL.createObjectURL(blob);
  urlCache.set(track.id, url);
  return url;
}

/** Free object URLs for local tracks that aren't current or next, so memory doesn't grow. */
function trimUrls() {
  const keep = new Set([state.queue[state.index], state.queue[state.index + 1], state.queue[state.index - 1]]);
  for (const [id, url] of urlCache) {
    if (!keep.has(id)) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
  }
}

function nextIndex(from: number): number | null {
  if (state.repeat === "one") return from;
  if (from + 1 < state.queue.length) return from + 1;
  if (state.repeat === "all" && state.queue.length) return 0;
  return null;
}

async function prepareNext() {
  const i = nextIndex(state.index);
  if (i === null || i === state.index) return;
  const t = trackById(state.queue[i]);
  if (t) await urlFor(t, true);
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

function announce(track: Track) {
  engine.setNowPlaying({ title: track.title, artist: track.artist, album: track.album, artwork: track.artwork });
  document.title = `${track.title} · ${track.artist} — Nightjar`;
}

async function startAt(index: number) {
  const id = state.queue[index];
  const track = trackById(id);
  if (!track) return;
  set({ index });
  const url = await urlFor(track);
  if (!url) {
    if (track.storage !== "cloud") toast(`“${track.title}” isn’t stored on this device anymore.`);
    return;
  }
  if (state.queue[state.index] !== id) return; // you moved on while it downloaded
  announce(track);
  await engine.play(track.id, url);
  trimUrls();
  void prepareNext();
}

/** Play a track, with the given list as the queue (defaults to the whole library). */
export function playTrack(id: string, list?: string[]) {
  const target = trackById(id);
  if (target?.storage === "cloud" && target.driveId) syncHooks.beforeCloudPlay?.();
  const base = list && list.length ? list : state.tracks.map((t) => t.id);
  let queue = base.slice();
  let index = Math.max(0, queue.indexOf(id));
  if (state.shuffle) {
    const rest = shuffled(queue.filter((x) => x !== id));
    queue = [id, ...rest];
    index = 0;
  }
  set({ queue, baseQueue: base.slice(), index });
  void startAt(index);
}

export function playList(ids: string[], shuffle = false) {
  if (!ids.length) return;
  if (shuffle && !state.shuffle) set({ shuffle: true });
  const first = shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
  playTrack(first, ids);
}

export function togglePlay() {
  const snap = engine.snapshot();
  if (snap.playing) engine.pause();
  else if (snap.trackId) void engine.resume();
  else if (state.queue.length) void startAt(Math.max(0, state.index));
  else if (state.tracks.length) playTrack(state.tracks[0].id);
}

export function next() {
  if (!state.queue.length) return;
  const i = state.index + 1 < state.queue.length ? state.index + 1 : state.repeat === "all" ? 0 : null;
  if (i === null) {
    engine.stop();
    set({ index: -1 });
    return;
  }
  void startAt(i);
}

export function previous() {
  const snap = engine.snapshot();
  if (snap.currentTime > 3 || state.index <= 0) {
    engine.seek(0);
    return;
  }
  void startAt(state.index - 1);
}

export function seek(seconds: number) {
  engine.seek(seconds);
}

export function toggleShuffle() {
  const on = !state.shuffle;
  const current = state.queue[state.index];
  if (!state.queue.length) {
    set({ shuffle: on });
    return;
  }
  if (on) {
    const rest = shuffled(state.queue.filter((_, i) => i !== state.index));
    const queue = current ? [current, ...rest] : rest;
    set({ shuffle: true, baseQueue: state.queue.slice(), queue, index: current ? 0 : -1 });
  } else {
    const queue = state.baseQueue.length ? state.baseQueue.slice() : state.queue.slice();
    set({ shuffle: false, queue, index: current ? queue.indexOf(current) : -1 });
  }
  void prepareNext();
}

export function cycleRepeat() {
  const order: RepeatMode[] = ["off", "all", "one"];
  set({ repeat: order[(order.indexOf(state.repeat) + 1) % order.length] });
  void prepareNext();
}

export function playNext(id: string) {
  if (!state.queue.length) {
    playTrack(id, [id]);
    return;
  }
  const queue = state.queue.slice();
  const existing = queue.indexOf(id);
  if (existing > state.index) queue.splice(existing, 1);
  queue.splice(state.index + 1, 0, id);
  set({ queue, baseQueue: [...state.baseQueue, id] });
  void prepareNext();
  toast("Plays next");
}

export function addToQueue(id: string) {
  if (!state.queue.length) {
    playTrack(id, [id]);
    return;
  }
  set({ queue: [...state.queue, id], baseQueue: [...state.baseQueue, id] });
  toast("Added to queue");
}

export function removeFromQueue(position: number) {
  if (position === state.index) return;
  const queue = state.queue.slice();
  queue.splice(position, 1);
  set({ queue, index: position < state.index ? state.index - 1 : state.index });
  void prepareNext();
}

export function clearUpcoming() {
  set({ queue: state.queue.slice(0, state.index + 1) });
}

export function jumpTo(position: number) {
  const target = trackById(state.queue[position]);
  if (target?.storage === "cloud" && target.driveId) syncHooks.beforeCloudPlay?.();
  void startAt(position);
}

export function setVolume(v: number) {
  engine.setVolume(v);
  set({ volume: v });
}

export function setCrossfade(seconds: number) {
  engine.setFade(seconds);
  set({ crossfade: seconds });
}

export function setEq(gains: number[], on: boolean) {
  engine.setEq(gains, on);
  set({ eqGains: gains, eqOn: on });
}

/* Engine wiring */
engine.setVolume(state.volume);
engine.setFade(state.crossfade);
engine.setEq(state.eqGains, state.eqOn);
engine.onEnded = () => {
  if (state.repeat === "one") void startAt(state.index);
  else next();
};
engine.onNext = () => next();
engine.onPrevious = () => previous();
engine.onError = (id, message) => {
  const t = trackById(id);
  toast(t ? `${t.title}: ${message}` : message);
};
engine.prefetch = () => {
  const i = nextIndex(state.index);
  if (i === null) return null;
  const t = trackById(state.queue[i]);
  if (!t) return null;
  const url = t.storage === "catalog" ? t.src : urlCache.get(t.id) ?? null;
  return url ? { id: t.id, url } : null;
};
// When the engine crossfades into the next track on its own, follow it in the queue.
engine.subscribe(() => {
  const id = engine.snapshot().trackId;
  if (!id || state.queue[state.index] === id) return;
  const i = nextIndex(state.index);
  if (i !== null && state.queue[i] === id) {
    set({ index: i });
    const t = trackById(id);
    if (t) announce(t);
    trimUrls();
    void prepareNext();
  }
});

/* ------------------------------------------------------------------ */
/* Playlists                                                           */
/* ------------------------------------------------------------------ */

export function createPlaylist(name: string, firstTrack?: string) {
  const now = Date.now();
  const p: Playlist = {
    id: `pl-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Untitled playlist",
    trackIds: firstTrack ? [firstTrack] : [],
    createdAt: now,
    updatedAt: now,
  };
  set({ playlists: [...state.playlists, p] });
  toast(firstTrack ? `Added to “${p.name}”` : `Created “${p.name}”`);
  return p;
}

export function addToPlaylist(playlistId: string, trackId: string) {
  const playlists = state.playlists.map((p) =>
    p.id === playlistId && !p.trackIds.includes(trackId) ? { ...p, trackIds: [...p.trackIds, trackId], updatedAt: Date.now() } : p,
  );
  set({ playlists });
  const p = playlists.find((x) => x.id === playlistId);
  if (p) toast(`Added to “${p.name}”`);
}

export function removeFromPlaylist(playlistId: string, trackId: string) {
  set({ playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId), updatedAt: Date.now() } : p)) });
}

export function renamePlaylist(playlistId: string, name: string) {
  set({ playlists: state.playlists.map((p) => (p.id === playlistId ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p)) });
}

export function deletePlaylist(playlistId: string) {
  set({ playlists: state.playlists.filter((p) => p.id !== playlistId) });
  if (state.view.name === "playlist") navigate({ name: "playlists" });
}

/* ------------------------------------------------------------------ */
/* Import and the local library                                        */
/* ------------------------------------------------------------------ */

type StoredTrack = Omit<Track, "artwork"> & { artKey: string | null };

async function saveLibraryIndex() {
  // Imported songs, plus songs you removed from this phone that are still in your account.
  const local: StoredTrack[] = state.tracks
    .filter((t) => t.storage === "local" || (t.storage === "cloud" && !t.id.startsWith("cloud-")))
    .map((t) => ({ ...t, artwork: undefined, artKey: t.hasEmbeddedArt ? `art:${t.id}` : null }) as unknown as StoredTrack);
  await idbPut(LIBRARY_KEY, new Blob([JSON.stringify(local)], { type: "application/json" }));
}

/** Load tracks imported in earlier visits. */
export async function loadLibrary() {
  try {
    const blob = await idbGet(LIBRARY_KEY);
    if (blob) {
      const stored = JSON.parse(await blob.text()) as StoredTrack[];
      const restored: Track[] = [];
      for (const s of stored) {
        let artwork: string | null = null;
        if (s.artKey) {
          const art = await idbGet(s.artKey);
          if (art) artwork = URL.createObjectURL(art);
        }
        const { artKey: _ignored, ...rest } = s;
        void _ignored;
        restored.push({ ...rest, artwork });
      }
      if (restored.length) {
        const merged = new Map<string, Track>();
        // Local files win over their cloud placeholders; cloud-only tracks are
        // retained if Firebase finished loading while IndexedDB was restoring.
        for (const track of restored) merged.set(track.id, track);
        for (const track of state.tracks) if (!merged.has(track.id)) merged.set(track.id, track);
        set({ tracks: [...merged.values()] });
      }
    }
  } catch {
    toast("Couldn’t read your imported library from this browser.");
  }
  set({ ready: true });
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "untitled";

function titleFromName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/^\d{1,3}[\s._-]+/, "")
    .replace(/[_]+/g, " ")
    .trim();
}

const AUDIO_EXT = /\.(wav|wave|flac|mp3|m4a|mp4|aac|ogg|oga|opus|webm|aif|aiff|aifc|wv|ape)$/i;

export async function importFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name));
  if (!files.length) {
    toast("No audio files there. Try WAV, FLAC, MP3, M4A, OGG or AIFF.");
    return;
  }
  const known = new Set(state.tracks.flatMap((t) => (t.storage === "cloud" ? [] : [t.fingerprint, t.songKey])).filter(Boolean));
  const added: Track[] = [];
  let skipped = 0;
  set({ importing: { done: 0, total: files.length } });
  for (const [i, file] of files.entries()) {
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
    if (known.has(fingerprint)) {
      skipped++;
      set({ importing: { done: i + 1, total: files.length } });
      continue;
    }
    try {
      const songKey = await songKeyFor(file);
      if (known.has(songKey)) {
        skipped++;
        set({ importing: { done: i + 1, total: files.length } });
        continue;
      }
      // Already in your account (e.g. imported on your other phone): reuse that entry so playlists keep working.
      const cloudTwin = state.tracks.find((t) => t.storage === "cloud" && t.songKey === songKey);
      const meta = await readFileMeta(file);
      const id = cloudTwin?.id ?? `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const url = URL.createObjectURL(file);
      const probe = await probePlayback(url);
      URL.revokeObjectURL(url);
      const album = meta.album || "Unknown album";
      const artist = meta.artist || "Unknown artist";
      let artwork: string | null = null;
      let glow = "#c45c26";
      if (meta.picture) {
        await idbPut(`art:${id}`, meta.picture);
        artwork = URL.createObjectURL(meta.picture);
        glow = (await glowFromImage(meta.picture)) ?? glow;
      }
      await idbPut(`audio:${id}`, file);
      const duration = probe.duration ?? meta.spec.duration ?? 0;
      const track: Track = {
        id,
        title: meta.title || titleFromName(file.name),
        artist,
        album,
        albumId: `local-${slug(artist)}-${slug(album)}`,
        trackNumber: meta.trackNumber ?? 0,
        duration,
        src: null,
        artwork,
        glow,
        format: { ...meta.spec, duration },
        bytes: file.size,
        addedAt: Date.now() + i,
        fileName: file.name,
        liner: null,
        storage: "local",
        hasEmbeddedArt: Boolean(meta.picture),
        playback: probe.ok ? "ready" : "unsupported",
        playbackNote: probe.ok
          ? meta.spec.lossless
            ? "Lossless file. The browser decodes it; bit-perfect output is not claimed."
            : "Compressed file, decoded by the browser."
          : "This browser can’t decode this format. It’s stored, and may play in another browser.",
        fingerprint,
        year: meta.year ?? undefined,
        songKey,
        driveId: cloudTwin?.driveId ?? null,
      };
      // Share album artwork across tracks of the same album that have none.
      added.push(track);
      known.add(fingerprint);
      known.add(songKey);
    } catch {
      toast(`Couldn’t import ${file.name}.`);
    }
    set({ importing: { done: i + 1, total: files.length } });
  }
  for (const t of added) {
    if (!t.artwork) {
      const sibling = added.find((x) => x.albumId === t.albumId && x.artwork);
      if (sibling) {
        t.artwork = sibling.artwork;
        t.glow = sibling.glow;
      }
    }
  }
  const addedIds = new Set(added.map((t) => t.id));
  set({ tracks: [...state.tracks.filter((t) => !addedIds.has(t.id)), ...added], importing: null });
  await saveLibraryIndex();
  const persisted = await requestPersistentStorage();
  const parts = [`Imported ${added.length} ${added.length === 1 ? "track" : "tracks"}`];
  if (skipped) parts.push(`${skipped} already here`);
  toast(parts.join(" · ") + (persisted ? "" : " · storage may be cleared if the device runs low"));
}

export async function removeTrack(id: string) {
  const t = trackById(id);
  if (!t || t.storage !== "local") return;
  if (state.queue[state.index] === id) engine.stop();
  const cloud = t.songKey ? syncHooks.inCloud?.(t.songKey) : null;
  if (cloud) {
    // Signed in and saved to your account: keep it in playlists, just drop the file from this phone.
    const url = urlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(id);
    set({ tracks: state.tracks.map((x) => (x.id === id ? { ...x, storage: "cloud" as const, driveId: cloud.driveId, bytes: x.bytes } : x)) });
    await idbDel(`audio:${id}`);
    await saveLibraryIndex();
    toast(cloud.driveId ? `Removed “${t.title}” from this device · still in your Google Drive` : `Removed “${t.title}” from this device`);
    return;
  }
  const queue = state.queue.filter((q) => q !== id);
  set({
    tracks: state.tracks.filter((x) => x.id !== id),
    queue,
    baseQueue: state.baseQueue.filter((q) => q !== id),
    index: Math.min(state.index, queue.length - 1),
    playlists: state.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((x) => x !== id) })),
  });
  await idbDel(`audio:${id}`);
  if (t.hasEmbeddedArt) await idbDel(`art:${id}`);
  await saveLibraryIndex();
  toast(`Removed “${t.title}” from this device`);
}

export function search(term: string) {
  const q = term.trim().toLowerCase();
  if (!q) return null;
  const tracks = state.tracks.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));
  const albums = state.albums.filter((a) => `${a.title} ${a.artist}`.toLowerCase().includes(q));
  return { tracks, albums };
}

/* ------------------------------------------------------------------ */
/* Used by sync.ts                                                     */
/* ------------------------------------------------------------------ */

/** Give older imports a song key (needed to sync them). */
export async function ensureSongKeys() {
  const missing = state.tracks.filter((t) => t.storage === "local" && !t.songKey);
  if (!missing.length) return;
  const keys = new Map<string, string>();
  for (const t of missing) {
    const blob = await idbGet(`audio:${t.id}`);
    if (blob) keys.set(t.id, await songKeyFor(blob));
  }
  applyRemote(() => set({ tracks: state.tracks.map((t) => (keys.has(t.id) ? { ...t, songKey: keys.get(t.id) } : t)) }));
  await saveLibraryIndex();
}

/** Replace the "in your account, not on this phone" songs, and refresh Drive ids. */
export function setCloudTracks(cloud: Track[], driveIds: Map<string, string | null>) {
  const keep = state.tracks.filter((t) => !(t.storage === "cloud" && t.id.startsWith("cloud-")));
  const updated = keep.map((t) => (t.songKey && driveIds.has(t.songKey) && t.driveId !== driveIds.get(t.songKey) ? { ...t, driveId: driveIds.get(t.songKey) ?? null } : t));
  applyRemote(() => set({ tracks: [...updated, ...cloud] }));
}

export function setPlaylistsFromRemote(playlists: Playlist[]) {
  applyRemote(() => set({ playlists }));
}

export function setSettingsFromRemote(s: SyncedSettings, updatedAt: number) {
  applyRemote(() => {
    engine.setFade(s.crossfade);
    engine.setEq(s.eqGains, s.eqOn);
    set({ crossfade: s.crossfade, eqOn: s.eqOn, eqGains: s.eqGains });
  });
  saveJSON(SETTINGS_TIME_KEY, updatedAt);
}

export { saveLibraryIndex };

/** "Download to this device" from the song menu, and "Download all" (quiet). Returns false if it failed. */
export async function downloadTrack(id: string, quiet = false) {
  const t = trackById(id);
  if (!t || t.storage !== "cloud") return true;
  if (!quiet) syncHooks.beforeCloudPlay?.();
  const url = await urlFor(t, quiet);
  if (url && quiet && state.queue[state.index] !== id) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
  if (url && !quiet) toast(`“${t.title}” is now on this device`);
  return Boolean(url);
}
