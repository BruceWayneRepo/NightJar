import { useMemo, useState } from "react";
import { formatBytes, formatTime } from "@/lib/nightjar/format";
import {
  clearUpcoming,
  createPlaylist,
  deletePlaylist,
  jumpTo,
  navigate,
  playList,
  removeFromPlaylist,
  removeFromQueue,
  renamePlaylist,
  search,
  trackById,
  useEngine,
  useStore,
} from "@/lib/nightjar/store";
import { AlbumCard, Artwork, Empty, PageHead, SongRow } from "./parts";
import { ChevronLeft, ChevronRight, Close, Gear, Import, ListIcon, People, Play, Plus, QueueIcon, Search as SearchIcon, Shuffle, Trash } from "./icons";

const byNewest = <T extends { addedAt: number }>(a: T, b: T) => b.addedAt - a.addedAt;

export function ListenView({ onImport }: { onImport: () => void }) {
  const tracks = useStore((s) => s.tracks);
  const albums = useStore((s) => s.albums);
  const [term, setTerm] = useState("");
  const results = useMemo(() => search(term), [term, tracks]);
  const local = tracks.filter((t) => t.storage === "local");
  const allIds = tracks.map((t) => t.id);
  return (
    <div className="nj-page">
      <PageHead eyebrow="Library" title="Listening room">
        <p className="nj-lede">
          Your collection, ready when you are. Import music or sign in to bring your library across devices.
        </p>
      </PageHead>
      <label className="nj-search">
        <SearchIcon size={16} />
        <input type="search" placeholder="Search songs, artists, albums" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search your library" />
        {term && (
          <button className="nj-icon-btn" aria-label="Clear search" onClick={() => setTerm("")}>
            <Close size={16} />
          </button>
        )}
      </label>

      {tracks.length === 0 ? (
        <section className="nj-section nj-library-empty">
          <Empty title="Your listening room is waiting.">
            <p>Import your first album to build your personal music library. Your files stay on this device unless you enable cloud backup.</p>
            <button className="nj-btn nj-btn-primary" onClick={onImport}><Import size={16} /> Import your music</button>
          </Empty>
        </section>
      ) : results ? (
        <>
          {results.albums.length > 0 && (
            <section className="nj-section">
              <h2 className="nj-h2">Albums</h2>
              <div className="nj-album-row">{results.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</div>
            </section>
          )}
          <section className="nj-section">
            <h2 className="nj-h2">Songs</h2>
            {results.tracks.length ? (
              <div className="nj-song-list">{results.tracks.map((t) => <SongRow key={t.id} track={t} list={results.tracks.map((x) => x.id)} />)}</div>
            ) : (
              <p className="nj-muted">Nothing matches “{term}”.</p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="nj-quick">
            <button className="nj-btn nj-btn-primary" onClick={() => playList(allIds)}>
              <Play size={16} /> Play all
            </button>
            <button className="nj-btn" onClick={() => playList(allIds, true)}>
              <Shuffle size={16} /> Shuffle
            </button>
            <button className="nj-btn nj-only-mobile" onClick={onImport}>
              <Import size={16} /> Import
            </button>
          </div>
          <section className="nj-section">
            <div className="nj-section-head">
              <h2 className="nj-h2">Albums</h2>
              <button className="nj-link" onClick={() => navigate({ name: "albums" })}>
                See all <ChevronRight size={14} />
              </button>
            </div>
            <div className="nj-album-row">{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</div>
          </section>
          {local.length > 0 && (
            <section className="nj-section">
              <h2 className="nj-h2">Recently imported</h2>
              <div className="nj-song-list">
                {local.slice().sort(byNewest).slice(0, 6).map((t) => <SongRow key={t.id} track={t} list={local.map((x) => x.id)} />)}
              </div>
            </section>
          )}
          <section className="nj-section">
            <h2 className="nj-h2">Songs</h2>
            <div className="nj-song-list">{tracks.slice().sort(byNewest).slice(0, 8).map((t) => <SongRow key={t.id} track={t} list={allIds} />)}</div>
          </section>
          <section className="nj-section nj-drop-hint">
            <Import size={20} />
            <div>
              <p className="nj-strong">Bring your own music</p>
              <p className="nj-muted">
                Drop audio files anywhere, or use Import. WAV, FLAC, AIFF, MP3, M4A, OGG and Opus are read on the device and stay there unless you turn on Google Drive backup.
              </p>
            </div>
            <button className="nj-btn" onClick={onImport}>Import audio</button>
          </section>
        </>
      )}
    </div>
  );
}

export function AlbumsView() {
  const albums = useStore((s) => s.albums);
  return (
    <div className="nj-page">
      <PageHead eyebrow="Library" title="Albums" />
      {albums.length ? <div className="nj-album-grid">{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</div> : <Empty title="No albums yet.">Import music to build your album library.</Empty>}
    </div>
  );
}

export function AlbumView({ id }: { id: string }) {
  const album = useStore((s) => s.albums.find((a) => a.id === id));
  const tracks = useStore((s) => s.tracks);
  if (!album) return <Empty title="This album isn’t in the library anymore." />;
  const list = album.trackIds.map((t) => trackById(t)).filter(Boolean) as typeof tracks;
  const total = list.reduce((s, t) => s + (t.duration || 0), 0);
  const bytes = list.reduce((s, t) => s + (t.bytes || 0), 0);
  return (
    <div className="nj-page nj-album-page" style={{ ["--glow" as string]: album.glow }}>
      <button className="nj-back" onClick={() => navigate({ name: "albums" })}>
        <ChevronLeft size={16} /> Albums
      </button>
      <div className="nj-album-hero">
        <Artwork src={album.artwork} alt={`${album.title} cover`} glow={album.glow} className="nj-album-hero-art" round={8} />
        <div className="nj-album-hero-text">
          <p className="nj-eyebrow">Album{album.year ? ` · ${album.year}` : ""}</p>
          <h1 className="nj-h1">{album.title}</h1>
          <button className="nj-link nj-album-artist" onClick={() => navigate({ name: "artist", name2: album.artist })}>{album.artist}</button>
          {album.blurb && <p className="nj-lede">{album.blurb}</p>}
          <p className="nj-muted nj-small">
            {list.length} {list.length === 1 ? "track" : "tracks"} · {formatTime(total)}
            {bytes ? ` · ${formatBytes(bytes)} on this device` : ""}
          </p>
          <div className="nj-quick">
            <button className="nj-btn nj-btn-primary" onClick={() => playList(album.trackIds)}>
              <Play size={16} /> Play
            </button>
            <button className="nj-btn" onClick={() => playList(album.trackIds, true)}>
              <Shuffle size={16} /> Shuffle
            </button>
          </div>
        </div>
      </div>
      <div className="nj-song-list">
        {list.map((t, i) => (
          <div key={t.id}>
            <SongRow track={t} list={album.trackIds} showArt={false} number={t.trackNumber || i + 1} />
            {t.liner && <p className="nj-liner">{t.liner}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArtistsView() {
  const tracks = useStore((s) => s.tracks);
  const artists = useMemo(() => {
    const map = new Map<string, { name: string; count: number; art: string | null; glow: string }>();
    for (const t of tracks) {
      const a = map.get(t.artist) ?? { name: t.artist, count: 0, art: t.artwork, glow: t.glow };
      a.count++;
      map.set(t.artist, a);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);
  return (
    <div className="nj-page">
      <PageHead eyebrow="Library" title="Artists" />
      {artists.length ? <div className="nj-artist-list">
        {artists.map((a) => (
          <button key={a.name} className="nj-artist" onClick={() => navigate({ name: "artist", name2: a.name })}>
            <Artwork src={a.art} alt="" glow={a.glow} size={52} round={26} />
            <span className="nj-song-text">
              <span className="nj-song-title">{a.name}</span>
              <span className="nj-song-sub">{a.count} {a.count === 1 ? "song" : "songs"}</span>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div> : <Empty title="No artists yet.">Artists appear here when you import or sync music.</Empty>}
    </div>
  );
}

export function ArtistView({ name }: { name: string }) {
  const allTracks = useStore((s) => s.tracks);
  const allAlbums = useStore((s) => s.albums);
  const tracks = useMemo(() => allTracks.filter((t) => t.artist === name), [allTracks, name]);
  const albums = useMemo(() => allAlbums.filter((a) => a.artist === name), [allAlbums, name]);
  const ids = tracks.map((t) => t.id);
  return (
    <div className="nj-page">
      <button className="nj-back" onClick={() => navigate({ name: "artists" })}>
        <ChevronLeft size={16} /> Artists
      </button>
      <PageHead eyebrow="Artist" title={name}>
        <div className="nj-quick">
          <button className="nj-btn nj-btn-primary" onClick={() => playList(ids)} disabled={!ids.length}>
            <Play size={16} /> Play
          </button>
          <button className="nj-btn" onClick={() => playList(ids, true)} disabled={!ids.length}>
            <Shuffle size={16} /> Shuffle
          </button>
        </div>
      </PageHead>
      {albums.length > 0 && (
        <section className="nj-section">
          <h2 className="nj-h2">Albums</h2>
          <div className="nj-album-row">{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</div>
        </section>
      )}
      <section className="nj-section">
        <h2 className="nj-h2">Songs</h2>
        <div className="nj-song-list">{tracks.map((t) => <SongRow key={t.id} track={t} list={ids} />)}</div>
      </section>
    </div>
  );
}

type SortKey = "added" | "title" | "artist" | "album";

export function SongsView() {
  const tracks = useStore((s) => s.tracks);
  const [sort, setSort] = useState<SortKey>("album");
  const sorted = useMemo(() => {
    const a = tracks.slice();
    if (sort === "title") a.sort((x, y) => x.title.localeCompare(y.title));
    if (sort === "artist") a.sort((x, y) => x.artist.localeCompare(y.artist) || x.album.localeCompare(y.album) || x.trackNumber - y.trackNumber);
    if (sort === "album") a.sort((x, y) => x.album.localeCompare(y.album) || x.trackNumber - y.trackNumber);
    if (sort === "added") a.sort(byNewest);
    return a;
  }, [tracks, sort]);
  const ids = sorted.map((t) => t.id);
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  return (
    <div className="nj-page">
      <PageHead eyebrow="Library" title="Songs">
        <p className="nj-muted nj-small">{tracks.length} songs · {formatTime(total)}</p>
      </PageHead>
      <div className="nj-toolbar">
        <button className="nj-btn nj-btn-primary" onClick={() => playList(ids)}>
          <Play size={16} /> Play
        </button>
        <button className="nj-btn" onClick={() => playList(ids, true)}>
          <Shuffle size={16} /> Shuffle
        </button>
        <label className="nj-select">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort songs">
            <option value="album">Album</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="added">Recently added</option>
          </select>
        </label>
      </div>
      {sorted.length ? <div className="nj-song-list">{sorted.map((t) => <SongRow key={t.id} track={t} list={ids} />)}</div> : <Empty title="Your song library is empty.">Import audio to see your tracks here.</Empty>}
    </div>
  );
}

export function PlaylistsView() {
  const playlists = useStore((s) => s.playlists);
  return (
    <div className="nj-page">
      <PageHead eyebrow="Library" title="Playlists">
        <p className="nj-lede">Use the ··· next to any song to add it to a playlist.</p>
      </PageHead>
      <NameForm id="new-playlist" label="New playlist name" submit="Create" onSubmit={(name) => createPlaylist(name)} icon={<Plus size={16} />} />
      {playlists.length === 0 ? (
        <Empty title="No playlists yet." />
      ) : (
        <div className="nj-artist-list nj-section">
          {playlists.map((p) => {
            const first = trackById(p.trackIds[0]);
            return (
              <button key={p.id} className="nj-artist" onClick={() => navigate({ name: "playlist", id: p.id })}>
                <Artwork src={first?.artwork ?? null} alt="" glow={first?.glow} size={52} round={6} />
                <span className="nj-song-text">
                  <span className="nj-song-title">{p.name}</span>
                  <span className="nj-song-sub">{p.trackIds.length} {p.trackIds.length === 1 ? "song" : "songs"}</span>
                </span>
                <ChevronRight size={16} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NameForm({ id, label, submit, initial = "", onSubmit, icon }: { id: string; label: string; submit: string; initial?: string; onSubmit: (name: string) => void; icon?: React.ReactNode }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="nj-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(value.trim());
        setValue(initial);
      }}
    >
      <input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder={label} aria-label={label} autoComplete="off" />
      <button type="submit" className="nj-btn nj-btn-primary" disabled={!value.trim()}>
        {icon} {submit}
      </button>
    </form>
  );
}

export function PlaylistView({ id }: { id: string }) {
  const playlist = useStore((s) => s.playlists.find((p) => p.id === id));
  useStore((s) => s.tracks);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!playlist) return <Empty title="This playlist was deleted." />;
  const tracks = playlist.trackIds.map((t) => trackById(t)).filter(Boolean) as NonNullable<ReturnType<typeof trackById>>[];
  return (
    <div className="nj-page">
      <button className="nj-back" onClick={() => navigate({ name: "playlists" })}>
        <ChevronLeft size={16} /> Playlists
      </button>
      <PageHead eyebrow="Playlist" title={playlist.name}>
        <div className="nj-quick">
          <button className="nj-btn nj-btn-primary" disabled={!tracks.length} onClick={() => playList(playlist.trackIds)}>
            <Play size={16} /> Play
          </button>
          <button className="nj-btn" disabled={!tracks.length} onClick={() => playList(playlist.trackIds, true)}>
            <Shuffle size={16} /> Shuffle
          </button>
          <button className="nj-btn" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Rename"}</button>
          {confirming ? (
            <>
              <button className="nj-btn nj-btn-danger" onClick={() => deletePlaylist(playlist.id)}>
                <Trash size={16} /> Yes, delete
              </button>
              <button className="nj-btn" onClick={() => setConfirming(false)}>Keep it</button>
            </>
          ) : (
            <button className="nj-btn nj-danger" onClick={() => setConfirming(true)}>
              <Trash size={16} /> Delete
            </button>
          )}
        </div>
        {confirming && <p className="nj-muted nj-small">Deleting removes the playlist only. The songs stay in your library.</p>}
        {editing && (
          <NameForm
            id={`rename-${playlist.id}`}
            label="Playlist name"
            submit="Save"
            initial={playlist.name}
            onSubmit={(name) => {
              renamePlaylist(playlist.id, name);
              setEditing(false);
            }}
          />
        )}
      </PageHead>
      {tracks.length === 0 ? (
        <Empty title="This playlist is empty.">Use the ··· next to any song and choose “Add to playlist”.</Empty>
      ) : (
        <div className="nj-song-list">
          {tracks.map((t) => (
            <SongRow key={t.id} track={t} list={playlist.trackIds} playlistId={playlist.id} onRemoveFromPlaylist={() => removeFromPlaylist(playlist.id, t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function QueueView() {
  const queue = useStore((s) => s.queue);
  const index = useStore((s) => s.index);
  useStore((s) => s.tracks);
  const snap = useEngine();
  const current = trackById(queue[index]);
  const upcoming = queue.slice(index + 1);
  return (
    <div className="nj-page">
      <PageHead eyebrow="Listening" title="Queue" />
      {!current ? (
        <Empty title="Nothing queued.">Play an album or song and the rest follows here.</Empty>
      ) : (
        <>
          <section className="nj-section">
            <h2 className="nj-h3">Now playing</h2>
            <div className="nj-queue-now">
              <Artwork src={current.artwork} alt="" glow={current.glow} size={56} round={6} />
              <div className="nj-song-text">
                <span className="nj-song-title">{current.title}</span>
                <span className="nj-song-sub">
                  {current.artist} · {formatTime(snap.currentTime)} / {formatTime(snap.duration || current.duration)}
                </span>
              </div>
            </div>
          </section>
          <section className="nj-section">
            <div className="nj-section-head">
              <h2 className="nj-h3">Up next · {upcoming.length}</h2>
              {upcoming.length > 0 && <button className="nj-link" onClick={clearUpcoming}>Clear</button>}
            </div>
            {upcoming.length === 0 ? (
              <p className="nj-muted">Nothing after this one.</p>
            ) : (
              <div className="nj-song-list">
                {upcoming.map((id, i) => {
                  const t = trackById(id);
                  if (!t) return null;
                  const pos = index + 1 + i;
                  return (
                    <div className="nj-song" key={`${id}-${pos}`}>
                      <button className="nj-song-main" onClick={() => jumpTo(pos)}>
                        <span className="nj-song-art"><Artwork src={t.artwork} alt="" glow={t.glow} size={44} round={4} /></span>
                        <span className="nj-song-text">
                          <span className="nj-song-title">{t.title}</span>
                          <span className="nj-song-sub">{t.artist}</span>
                        </span>
                        <span className="nj-song-time">{formatTime(t.duration)}</span>
                      </button>
                      <button className="nj-icon-btn" aria-label={`Remove ${t.title} from queue`} onClick={() => removeFromQueue(pos)}>
                        <Close size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function MoreView() {
  const items = [
    { label: "Artists", icon: <People />, view: { name: "artists" } as const },
    { label: "Playlists", icon: <ListIcon />, view: { name: "playlists" } as const },
    { label: "Queue", icon: <QueueIcon />, view: { name: "queue" } as const },
    { label: "Settings", icon: <Gear />, view: { name: "settings" } as const },
  ];
  return (
    <div className="nj-page">
      <PageHead title="More" />
      <div className="nj-artist-list">
        {items.map((i) => (
          <button key={i.label} className="nj-artist nj-more-item" onClick={() => navigate(i.view)}>
            <span className="nj-more-icon">{i.icon}</span>
            <span className="nj-song-title">{i.label}</span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
