import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatTime, specLine } from "@/lib/nightjar/format";
import {
  addToPlaylist,
  addToQueue,
  createPlaylist,
  downloadTrack,
  navigate,
  playNext,
  playTrack,
  removeTrack,
  useEngine,
  useStore,
} from "@/lib/nightjar/store";
import type { Album, Track } from "@/lib/nightjar/types";
import { Dots, Moon, Pause, Play } from "./icons";

export function Artwork({ src, alt, glow, size, round = 6, className = "" }: { src: string | null; alt: string; glow?: string; size?: number | string; round?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const style: CSSProperties = { width: size, height: size, borderRadius: round, ["--glow" as string]: glow ?? "#c45c26" };
  if (!src || failed) {
    return (
      <div className={`nj-art nj-art-empty ${className}`} style={style} role="img" aria-label={alt}>
        <Moon size={typeof size === "number" ? Math.max(14, size * 0.28) : 28} />
      </div>
    );
  }
  return <img className={`nj-art ${className}`} style={style} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function AlbumCard({ album }: { album: Album }) {
  return (
    <button className="nj-album-card" onClick={() => navigate({ name: "album", id: album.id })}>
      <Artwork src={album.artwork} alt={`${album.title} cover`} glow={album.glow} className="nj-album-card-art" />
      <span className="nj-album-card-title">{album.title}</span>
      <span className="nj-album-card-artist">{album.artist}</span>
    </button>
  );
}

function SongMenu({ track, onClose, anchor, playlistId, onRemoveFromPlaylist }: { track: Track; onClose: () => void; anchor: DOMRect; playlistId?: string; onRemoveFromPlaylist?: () => void }) {
  const playlists = useStore((s) => s.playlists);
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState(false);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 320);
  const right = Math.max(8, window.innerWidth - anchor.right);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div className="nj-menu" ref={ref} role="menu" style={{ top, right }}>
      {!sub ? (
        <>
          <button role="menuitem" onClick={act(() => playNext(track.id))}>Play next</button>
          <button role="menuitem" onClick={act(() => addToQueue(track.id))}>Add to queue</button>
          <button role="menuitem" onClick={() => setSub(true)}>Add to playlist…</button>
          <button role="menuitem" onClick={act(() => navigate({ name: "album", id: track.albumId }))}>Go to album</button>
          <button role="menuitem" onClick={act(() => navigate({ name: "artist", name2: track.artist }))}>Go to artist</button>
          {playlistId && onRemoveFromPlaylist && (
            <button role="menuitem" onClick={act(onRemoveFromPlaylist)}>Remove from this playlist</button>
          )}
          {track.storage === "cloud" && track.driveId && (
            <button role="menuitem" onClick={act(() => void downloadTrack(track.id))}>Download to this device</button>
          )}
          {track.storage === "local" && (
            <button role="menuitem" className="nj-danger" onClick={act(() => void removeTrack(track.id))}>Remove from this device</button>
          )}
        </>
      ) : (
        <>
          <form
            className="nj-menu-form"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
              createPlaylist(input.value, track.id);
              onClose();
            }}
          >
            <input id={`np-${track.id}`} name="name" placeholder="New playlist name" aria-label="New playlist name" autoComplete="off" />
            <button type="submit" className="nj-btn nj-btn-primary">Add</button>
          </form>
          {playlists.map((p) => (
            <button role="menuitem" key={p.id} onClick={act(() => addToPlaylist(p.id, track.id))}>{p.name}</button>
          ))}
          <button role="menuitem" className="nj-muted" onClick={() => setSub(false)}>Back</button>
        </>
      )}
    </div>
  );
}

export function SongRow({ track, list, showArt = true, number, playlistId, onRemoveFromPlaylist }: { track: Track; list: string[]; showArt?: boolean; number?: number; playlistId?: string; onRemoveFromPlaylist?: () => void }) {
  const snap = useEngine();
  const isCurrent = snap.trackId === track.id;
  const [menu, setMenu] = useState<DOMRect | null>(null);
  return (
    <div className={`nj-song ${isCurrent ? "is-current" : ""} ${track.playback === "unsupported" ? "is-unsupported" : ""} ${track.storage === "cloud" ? "is-cloud" : ""}`}>
      <button className="nj-song-main" onClick={() => playTrack(track.id, list)} aria-label={`Play ${track.title} by ${track.artist}`}>
        {showArt ? (
          <span className="nj-song-art">
            <Artwork src={track.artwork} alt="" glow={track.glow} size={44} round={4} />
            {isCurrent && <span className="nj-song-art-state">{snap.playing ? <Bars /> : <Pause size={14} />}</span>}
          </span>
        ) : (
          <span className="nj-song-num">{isCurrent ? (snap.playing ? <Bars /> : <Play size={12} />) : number ?? (track.trackNumber || "–")}</span>
        )}
        <span className="nj-song-text">
          <span className="nj-song-title">{track.title}</span>
          <span className="nj-song-sub">
            {track.artist} · {specLine(track.format)}
            {track.playback === "unsupported" && " · can’t play in this browser"}
            {track.storage === "cloud" && (track.driveId ? " · in your Drive" : " · on your other device")}
          </span>
        </span>
        <span className="nj-song-time">{formatTime(track.duration)}</span>
      </button>
      <button className="nj-icon-btn nj-song-more" aria-label={`More options for ${track.title}`} onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}>
        <Dots size={18} />
      </button>
      {menu && <SongMenu track={track} anchor={menu} onClose={() => setMenu(null)} playlistId={playlistId} onRemoveFromPlaylist={onRemoveFromPlaylist} />}
    </div>
  );
}

export function Bars() {
  return (
    <span className="nj-bars" aria-label="Playing">
      <i />
      <i />
      <i />
    </span>
  );
}

export function SeekBar({ current, duration, onSeek, className = "" }: { current: number; duration: number; onSeek: (s: number) => void; className?: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const value = drag ?? current;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0;

  const commit = () => {
    const next = pending.current;
    pending.current = null;
    setDrag(null);
    if (next !== null && Number.isFinite(next) && duration > 0) {
      onSeek(Math.max(0, Math.min(duration, next)));
    }
  };

  const update = (raw: string) => {
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    pending.current = next;
    setDrag(next);
  };

  return (
    <input
      type="range"
      className={`nj-range nj-seek ${className}`}
      min={0}
      max={duration > 0 ? duration : 1}
      step={0.05}
      value={duration > 0 ? Math.min(duration, Math.max(0, value)) : 0}
      disabled={!duration || duration <= 0}
      aria-label="Seek"
      aria-valuetext={`${formatTime(value)} of ${formatTime(duration)}`}
      style={{ ["--pct" as string]: `${pct}%` }}
      onChange={(e) => update(e.currentTarget.value)}
      onPointerUp={commit}
      onPointerCancel={commit}
      onLostPointerCapture={commit}
      onKeyDown={(e) => {
        // Arrow keys jump 5 s (10 s for Page Up/Down). The fine pointer step is far too small for keys.
        const jump = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -10, PageUp: 10 }[e.key];
        if (jump === undefined || !(duration > 0)) return;
        e.preventDefault();
        const base = pending.current ?? current;
        pending.current = Math.max(0, Math.min(duration, base + jump));
        commit();
      }}
      onKeyUp={(e) => {
        if (e.key === "Home" || e.key === "End") commit();
      }}
      onBlur={() => {
        if (pending.current !== null) commit();
        else {
          setDrag(null);
        }
      }}
    />
  );
}

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="nj-page-head">
      {eyebrow && <p className="nj-eyebrow">{eyebrow}</p>}
      <h1 className="nj-h1">{title}</h1>
      {children}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="nj-empty">
      <Moon size={28} />
      <p className="nj-empty-title">{title}</p>
      {children && <div className="nj-empty-body">{children}</div>}
    </div>
  );
}
