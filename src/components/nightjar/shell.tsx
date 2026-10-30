import { useEffect, useRef, useState } from "react";
import { engine } from "@/lib/nightjar/engine";
import {
  getState,
  importFiles,
  loadLibrary,
  navigate,
  next,
  previous,
  setNowPlayingOpen,
  setVolume,
  togglePlay,
  useStore,
} from "@/lib/nightjar/store";
import { applyUpdate, dismissOfflineReady, usePwa } from "@/lib/nightjar/pwa";
import type { View } from "@/lib/nightjar/types";
import { Disc, Gear, Import, ListIcon, Moon, More, People, QueueIcon, Songs, Wave } from "./icons";
import { MiniPlayer, NowPlaying, PlayerBar } from "./player";
import { SettingsView } from "./settings";
import {
  AlbumView,
  AlbumsView,
  ArtistView,
  ArtistsView,
  ListenView,
  MoreView,
  PlaylistView,
  PlaylistsView,
  QueueView,
  SongsView,
} from "./views";

const NAV: { label: string; view: View; icon: JSX.Element; match: View["name"][] }[] = [
  { label: "Listen", view: { name: "listen" }, icon: <Wave size={18} />, match: ["listen"] },
  { label: "Albums", view: { name: "albums" }, icon: <Disc size={18} />, match: ["albums", "album"] },
  { label: "Artists", view: { name: "artists" }, icon: <People size={18} />, match: ["artists", "artist"] },
  { label: "Songs", view: { name: "songs" }, icon: <Songs size={18} />, match: ["songs"] },
  { label: "Playlists", view: { name: "playlists" }, icon: <ListIcon size={18} />, match: ["playlists", "playlist"] },
  { label: "Queue", view: { name: "queue" }, icon: <QueueIcon size={18} />, match: ["queue"] },
  { label: "Settings", view: { name: "settings" }, icon: <Gear size={18} />, match: ["settings"] },
];

const TABS: { label: string; view: View; match: View["name"][] }[] = [
  { label: "Listen", view: { name: "listen" }, match: ["listen"] },
  { label: "Albums", view: { name: "albums" }, match: ["albums", "album"] },
  { label: "Songs", view: { name: "songs" }, match: ["songs"] },
  { label: "More", view: { name: "more" }, match: ["more", "artists", "artist", "playlists", "playlist", "queue", "settings"] },
];

function Main({ view, onImport }: { view: View; onImport: () => void }) {
  switch (view.name) {
    case "listen":
      return <ListenView onImport={onImport} />;
    case "albums":
      return <AlbumsView />;
    case "album":
      return <AlbumView id={view.id} />;
    case "artists":
      return <ArtistsView />;
    case "artist":
      return <ArtistView name={view.name2} />;
    case "songs":
      return <SongsView />;
    case "playlists":
      return <PlaylistsView />;
    case "playlist":
      return <PlaylistView id={view.id} />;
    case "queue":
      return <QueueView />;
    case "settings":
      return <SettingsView />;
    case "more":
      return <MoreView />;
  }
}

function PwaBar() {
  const pwa = usePwa();
  useEffect(() => {
    if (!pwa.offlineReady) return;
    const t = window.setTimeout(dismissOfflineReady, 5000);
    return () => window.clearTimeout(t);
  }, [pwa.offlineReady]);
  if (pwa.updateReady) {
    return (
      <div className="nj-pwa-bar" role="status">
        <span>A new version of Nightjar is ready.</span>
        <button className="nj-btn nj-btn-primary" onClick={applyUpdate}>Reload</button>
      </div>
    );
  }
  if (pwa.offlineReady) {
    return (
      <div className="nj-pwa-bar" role="status">
        <span>Nightjar is saved on this device and now works offline.</span>
        <button className="nj-btn" onClick={dismissOfflineReady}>OK</button>
      </div>
    );
  }
  return null;
}

export function Shell() {
  const view = useStore((s) => s.view);
  const toasts = useStore((s) => s.toasts);
  const importing = useStore((s) => s.importing);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    void loadLibrary();
  }, []);

  // Keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") && el.getAttribute("type") !== "range") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const snap = engine.snapshot();
      if (e.key === " " && !el.closest("button")) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight" && el.getAttribute("type") !== "range") engine.seek(snap.currentTime + 5);
      else if (e.key === "ArrowLeft" && el.getAttribute("type") !== "range") engine.seek(snap.currentTime - 5);
      else if (e.key === "ArrowUp" && el.getAttribute("type") !== "range") {
        e.preventDefault();
        setVolume(Math.min(1, getState().volume + 0.05));
      } else if (e.key === "ArrowDown" && el.getAttribute("type") !== "range") {
        e.preventDefault();
        setVolume(Math.max(0, getState().volume - 0.05));
      } else if (e.key.toLowerCase() === "n") next();
      else if (e.key.toLowerCase() === "p") previous();
      else if (e.key.toLowerCase() === "f" && snap.trackId) setNowPlayingOpen(!getState().nowPlayingOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drag and drop anywhere
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const openImport = () => fileRef.current?.click();
  const active = (match: View["name"][]) => match.includes(view.name);

  return (
    <div className="nj-app">
      <aside className="nj-sidebar" aria-label="Library navigation">
        <button className="nj-brand" onClick={() => navigate({ name: "listen" })} aria-label="Nightjar home">
          <Moon size={18} /> <span>nightjar</span>
        </button>
        <nav className="nj-nav">
          {NAV.map((n) => (
            <button key={n.label} className={`nj-nav-item ${active(n.match) ? "is-active" : ""}`} aria-current={active(n.match) ? "page" : undefined} onClick={() => navigate(n.view)}>
              {n.icon}
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <button className="nj-btn nj-btn-primary nj-import-btn" onClick={openImport}>
          <Import size={16} /> Import audio
        </button>
      </aside>

      <header className="nj-topbar">
        <button className="nj-brand" onClick={() => navigate({ name: "listen" })} aria-label="Nightjar home">
          <Moon size={18} /> <span>nightjar</span>
        </button>
        <button className="nj-icon-btn nj-round" aria-label="Import audio" onClick={openImport}>
          <Import size={18} />
        </button>
      </header>

      <main className="nj-main" id="nj-main">
        <Main view={view} onImport={openImport} />
      </main>

      <PlayerBar />
      <MiniPlayer />

      <nav className="nj-tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.label} className={`nj-tab ${active(t.match) ? "is-active" : ""}`} aria-current={active(t.match) ? "page" : undefined} onClick={() => navigate(t.view)}>
            {t.label === "Listen" && <Wave size={18} />}
            {t.label === "Albums" && <Disc size={18} />}
            {t.label === "Songs" && <Songs size={18} />}
            {t.label === "More" && <More size={18} />}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <NowPlaying />
      <PwaBar />

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.flac,.wav,.aif,.aiff,.m4a,.opus,.ogg,.mp3,.wv,.ape"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {dragging && (
        <div className="nj-dropzone" aria-hidden="true">
          <Import size={32} />
          <p>Drop to add to your listening room</p>
          <span>Files stay on this device</span>
        </div>
      )}

      <div className="nj-toasts" role="status" aria-live="polite">
        {importing && (
          <div className="nj-toast">
            Importing {importing.done} of {importing.total}…
          </div>
        )}
        {toasts.map((t) => (
          <div key={t.id} className="nj-toast">{t.text}</div>
        ))}
      </div>
    </div>
  );
}
