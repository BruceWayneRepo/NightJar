# Nightjar

A local-first player for high-quality audio. Your files stay in the browser, format details are read from each file's header, and the app tells you when the browser changes the sound on the way out.

## Run it

```
npm install
npm run dev        # open the address it prints
npm run build      # static site in dist/, ready for GitHub Pages or any host
```

**Live site:** https://night-jar-five.vercel.app (install from this one: it has its own address, so Android can install it as an app).
Every push to `main` also publishes https://brucewaynerepo.github.io/NightJar/ (`.github/workflows/deploy.yml`).
Open it once on your phone, then tap **Install** (Settings → App, or Chrome ⋮ → Install app). After that it opens offline.

**Accounts and sync (optional):** see [SETUP-SYNC.md](SETUP-SYNC.md). Without it, Nightjar works fully on one device.

If `public/audio/roost.wav` or `platform.wav` are missing, run `python scripts/make_sample_songs.py` (needs numpy).

## What's inside

- **Listening room:** albums, songs, search, play all, shuffle.
- **Albums, Artists, Songs, Playlists, Queue** views; ··· menu on every song (play next, add to queue, add to playlist, go to album or artist, remove).
- **Now playing:** large artwork with a glow from the album colour, live visualizer, signal-path details.
- **Import:** pick or drop WAV, FLAC, AIFF, MP3, M4A, OGG, Opus. Tags, cover art and real format details are read on the device and stored in IndexedDB. Nothing is uploaded.
- **Playback engine:** two-deck crossfade (works with the screen off), 5-band EQ with presets, repeat and shuffle, lock-screen and headset controls (Media Session), keyboard shortcuts.
- **Storage:** asks the browser to keep the library safe, shows space used and free.
- Works on phones (bottom tabs and mini player) and desktops (sidebar and player bar).
- **Offline + install (1.2):** a service worker saves the app, covers and sample songs on first visit; installs like a normal app on Android; shows "Update ready · Reload" instead of cutting off music.
- **Sync (1.3, optional):** Google sign-in; playlists, crossfade and EQ sync live between devices; songs are recognised across devices by a fingerprint of the file; song files can be backed up to a "Nightjar Music" folder in your own Google Drive and download on first play elsewhere. Works offline and catches up when back online.

## Files

| Path | What it does |
| --- | --- |
| `src/lib/nightjar/engine.ts` | Audio engine: decks, crossfade, EQ, analyser, Media Session |
| `src/lib/nightjar/store.ts` | Library, queue, shuffle/repeat, playlists, settings, import |
| `src/lib/nightjar/metadata.ts` | Reads WAV / FLAC / AIFF / MP3 headers, tags and cover art |
| `src/lib/nightjar/idb.ts` | On-device file storage |
| `src/lib/nightjar/catalog.ts` | The built-in sample albums |
| `src/lib/nightjar/format.ts` | Display formatting (kHz, kbps, time, sizes, signal path) |
| `src/lib/nightjar/pwa.ts`, `src/sw.ts` | Offline support and install prompt |
| `src/lib/nightjar/sync.ts` | Account sync (Firebase Auth + Firestore), loaded only when set up |
| `src/lib/nightjar/sync-state.ts` | What the Settings screen shows about your account |
| `src/lib/nightjar/drive.ts` | Song backup to your Google Drive |
| `src/lib/nightjar/songkey.ts` | Recognises the same song on different devices |
| `src/firebase-config.ts` | Paste your Firebase settings here to turn sync on |
| `firestore.rules` | Database rules: each person can only see their own data |
| `src/components/nightjar/*` | Screens: shell, views, player, settings, account, shared parts, icons |

## Changes from the Drive upload (Oct 2026)

The original upload stopped at files starting with "o", so the screens, types, styles and build files were missing. They were rebuilt to match the original screenshots, around the original engine, catalog, format and storage code. The project moved from TanStack Start + Grok sign-in to a plain Vite + React static site, since a local-first player needs no server or account. "Roost" and "Platform" were recreated because their audio files were lost.
