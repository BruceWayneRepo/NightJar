import { useEffect, useRef, useState } from "react";
import { engine } from "@/lib/nightjar/engine";
import { channelLabel, formatBytes, formatKhz, formatTime, pathSummary, specLine } from "@/lib/nightjar/format";
import {
  currentTrack,
  cycleRepeat,
  next,
  previous,
  seek,
  setNowPlayingOpen,
  setVolume,
  togglePlay,
  toggleShuffle,
  useEngine,
  useStore,
} from "@/lib/nightjar/store";
import { Artwork, SeekBar } from "./parts";
import { ChevronDown, Info, Mute, Next, Pause, Play, Prev, Repeat, RepeatOne, Shuffle, Volume } from "./icons";

function Transport({ big = false }: { big?: boolean }) {
  const snap = useEngine();
  const shuffle = useStore((s) => s.shuffle);
  const repeat = useStore((s) => s.repeat);
  const s = big ? 26 : 20;
  return (
    <div className={`nj-transport ${big ? "is-big" : ""}`}>
      <button className={`nj-icon-btn ${shuffle ? "is-on" : ""}`} aria-label="Shuffle" aria-pressed={shuffle} onClick={toggleShuffle}>
        <Shuffle size={s - 2} />
      </button>
      <button className="nj-icon-btn" aria-label="Previous" onClick={previous}>
        <Prev size={s} />
      </button>
      <button className="nj-play" aria-label={snap.playing ? "Pause" : "Play"} onClick={togglePlay}>
        {snap.playing ? <Pause size={big ? 30 : 22} /> : <Play size={big ? 30 : 22} />}
      </button>
      <button className="nj-icon-btn" aria-label="Next" onClick={next}>
        <Next size={s} />
      </button>
      <button className={`nj-icon-btn ${repeat !== "off" ? "is-on" : ""}`} aria-label={`Repeat: ${repeat}`} onClick={cycleRepeat}>
        {repeat === "one" ? <RepeatOne size={s - 2} /> : <Repeat size={s - 2} />}
      </button>
    </div>
  );
}

function VolumeControl() {
  const volume = useStore((s) => s.volume);
  const before = useRef(0.82);
  return (
    <div className="nj-volume">
      <button
        className="nj-icon-btn"
        aria-label={volume === 0 ? "Unmute" : "Mute"}
        onClick={() => {
          if (volume > 0) {
            before.current = volume;
            setVolume(0);
          } else setVolume(before.current || 0.82);
        }}
      >
        {volume === 0 ? <Mute size={18} /> : <Volume size={18} />}
      </button>
      <input type="range" className="nj-range" min={0} max={1} step={0.01} value={volume} aria-label="Volume" style={{ ["--pct" as string]: `${volume * 100}%` }} onChange={(e) => setVolume(Number(e.target.value))} />
    </div>
  );
}

/** Desktop bar along the bottom. */
export function PlayerBar() {
  const snap = useEngine();
  const [scrub, setScrub] = useState<number | null>(null);
  useStore((s) => s.index);
  const track = currentTrack();
  return (
    <footer className="nj-playerbar" style={{ ["--glow" as string]: track?.glow ?? "#c45c26" }}>
      <div className="nj-playerbar-seek">
        <span className="nj-time">{formatTime(scrub ?? snap.currentTime)}</span>
        <SeekBar current={snap.currentTime} duration={snap.duration} onSeek={seek} onScrub={setScrub} />
        <span className="nj-time">{formatTime(snap.duration)}</span>
      </div>
      <div className="nj-playerbar-row">
        <button className="nj-now" onClick={() => track && setNowPlayingOpen(true)} disabled={!track} aria-label="Open now playing">
          <Artwork src={track?.artwork ?? null} alt="" glow={track?.glow} size={48} round={4} />
          <span className="nj-song-text">
            <span className="nj-song-title">{track?.title ?? "Nothing playing"}</span>
            <span className="nj-song-sub">{track ? `${track.artist} · ${specLine(track.format)}` : "Choose a session"}</span>
          </span>
        </button>
        <Transport />
        <VolumeControl />
      </div>
    </footer>
  );
}

/** Phone mini player above the tabs. */
export function MiniPlayer() {
  const snap = useEngine();
  useStore((s) => s.index);
  const track = currentTrack();
  const pct = snap.duration ? (snap.currentTime / snap.duration) * 100 : 0;
  return (
    <div className="nj-mini" style={{ ["--glow" as string]: track?.glow ?? "#c45c26" }}>
      <div className="nj-mini-progress" style={{ width: `${pct}%` }} />
      <button className="nj-now" onClick={() => track && setNowPlayingOpen(true)} disabled={!track} aria-label="Open now playing">
        <Artwork src={track?.artwork ?? null} alt="" glow={track?.glow} size={48} round={4} />
        <span className="nj-song-text">
          <span className="nj-song-title">{track?.title ?? "Nothing playing"}</span>
          <span className="nj-song-sub">{track?.artist ?? "Choose a session"}</span>
        </span>
      </button>
      <button className="nj-icon-btn" aria-label="Previous" onClick={previous}>
        <Prev size={20} />
      </button>
      <button className="nj-play nj-play-sm" aria-label={snap.playing ? "Pause" : "Play"} onClick={togglePlay}>
        {snap.playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <button className="nj-icon-btn" aria-label="Next" onClick={next}>
        <Next size={20} />
      </button>
    </div>
  );
}

function Visualizer({ playing, glow }: { playing: boolean; glow: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const data = new Uint8Array(32);
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const analyser = engine.getAnalyser();
      if (analyser) analyser.getByteFrequencyData(data);
      else data.fill(0);
      const bars = 28;
      const gap = 3;
      const bw = (w - gap * (bars - 1)) / bars;
      ctx.fillStyle = glow;
      for (let i = 0; i < bars; i++) {
        // Spread the bins on a curve so mids and highs get bars too, and lift them a little.
        const bin = Math.min(data.length - 1, Math.floor(Math.pow(i / bars, 1.7) * 26));
        const v = Math.min(1, ((data[bin] ?? 0) / 255) * (1 + (i / bars) * 1.6));
        const bh = Math.max(2, v * h);
        ctx.globalAlpha = 0.35 + v * 0.6;
        ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
      }
      ctx.globalAlpha = 1;
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing, glow]);
  return <canvas ref={ref} className="nj-viz" aria-hidden="true" />;
}

export function NowPlaying() {
  const open = useStore((s) => s.nowPlayingOpen);
  const crossfade = useStore((s) => s.crossfade);
  const eqOn = useStore((s) => s.eqOn);
  useStore((s) => s.index);
  const snap = useEngine();
  const track = currentTrack();
  const [details, setDetails] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNowPlayingOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !track) return null;
  const path = pathSummary(track, snap.sampleRate, eqOn, crossfade);
  const ctxLine = snap.sampleRate ? `Output context ${formatKhz(snap.sampleRate)} kHz · not bit-perfect` : "Output context opens on first play";
  return (
    <div className="nj-np" role="dialog" aria-modal="true" aria-label={`Now playing: ${track.title}`} style={{ ["--glow" as string]: track.glow }}>
      <div className="nj-np-inner">
        <div className="nj-np-top">
          <button className="nj-link" ref={closeRef} onClick={() => setNowPlayingOpen(false)}>
            <ChevronDown size={18} /> Close
          </button>
          <span className="nj-eyebrow">{track.album}</span>
        </div>
        <Artwork src={track.artwork} alt={`${track.album} cover`} glow={track.glow} className="nj-np-art" round={8} />
        <div className="nj-np-meta">
          <h2 className="nj-np-title">{track.title}</h2>
          <p className="nj-np-artist">{track.artist}</p>
          <p className="nj-np-spec">{specLine(track.format)}</p>
          <p className="nj-np-ctx">{ctxLine}</p>
          {snap.error && <p className="nj-error">{snap.error}</p>}
        </div>
        <Visualizer playing={snap.playing} glow={track.glow} />
        <div className="nj-np-seek">
          <span className="nj-time">{formatTime(scrub ?? snap.currentTime)}</span>
          <SeekBar current={snap.currentTime} duration={snap.duration} onSeek={seek} onScrub={setScrub} />
          <span className="nj-time">{formatTime(snap.duration)}</span>
        </div>
        <Transport big />
        <button className="nj-link nj-np-details-toggle" onClick={() => setDetails(!details)} aria-expanded={details}>
          <Info size={16} /> {details ? "Hide" : "Show"} signal path
        </button>
        {details && (
          <dl className="nj-facts nj-np-details">
            <div><dt>File</dt><dd>{track.fileName ?? "—"}</dd></div>
            <div><dt>Format</dt><dd>{track.format.container} · {track.format.lossless ? "lossless" : "lossy"}</dd></div>
            <div><dt>Channels</dt><dd>{channelLabel(track.format.channels)}</dd></div>
            {track.bytes ? <div><dt>Size</dt><dd>{formatBytes(track.bytes)}</dd></div> : null}
            <div><dt>Stored</dt><dd>{track.storage === "local" ? "In this browser" : "Nightjar catalog"}</dd></div>
            <div><dt>Resampling</dt><dd>{path.resample}</dd></div>
            <div><dt>Processing</dt><dd>{path.processing}</dd></div>
            <div><dt>Note</dt><dd>{track.playbackNote}</dd></div>
            {track.liner && <div><dt>Liner</dt><dd>{track.liner}</dd></div>}
          </dl>
        )}
      </div>
    </div>
  );
}
