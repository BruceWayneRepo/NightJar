# Nightjar implementation handoff

This package is a source-level improvement pass over the uploaded NightJar project snapshot.

## Changes included

### Library and sample content
- Removed the four bundled demo albums and their six sample WAV files.
- Removed the sample cover artwork and sample-song generator.
- Made the initial catalogue empty.
- Added a deliberate empty-library state with an Import action.
- Fixed the Listening Room song section so it displays the user's actual tracks rather than only `storage === "catalog"` tracks.
- Added empty states for Albums, Artists and Songs.
- Updated README and sync setup documentation to remove outdated sample-song and hourly-reconnect instructions.

### Playback seeking
- Reworked `SeekBar` to use a ref-backed pending seek value, avoiding reliance on a possibly stale React state value at pointer release.
- Commits seeks on pointer release, pointer cancellation, lost pointer capture, keyboard release and blur.
- Clamps seeks to the current duration and improves the touch target.

### Navigation
- Added in-app browser history entries for view changes.
- Added `popstate` handling for browser Back and Android system Back.
- Settings always returns to Listening Room/Home when Back is used.
- Added an explicit Back to Home control in Settings.

### Synchronisation and recovery
- Song records are now added to the in-memory remote map only after Firestore confirms the write.
- Failed song writes receive bounded exponential retries.
- Firestore optimistic local snapshots are ignored when constructing confirmed remote song/playlist maps.
- Playlist writes and tombstones now await Firestore, only update the remote map after success, and retry failures.
- If a playlist changes while an earlier write is in flight, the newest version is queued after the earlier write finishes.
- Drive backup no longer marks a song as backed up in memory before Firestore confirms its Drive file ID.
- Fixed a backup lock race while the Drive access token is being refreshed.
- Settings sync failures now produce a user-facing message rather than an unhandled rejection.
- Clearing/switching Firebase accounts clears the current Drive access token.
- A Drive refresh response is discarded if the signed-in account changed while the request was in flight.

### Download All
- A single failed download no longer stops the entire batch.
- Progress advances for successes and failures.
- The batch stops early when Drive authorization is unavailable, instead of repeatedly attempting every remaining song.
- A summary toast reports successes and failures. Failed cloud tracks remain available to retry on the next run.

### PWA and visual refinement
- Removed sample-audio range caching from the service worker because user music is stored in IndexedDB and no demo audio is bundled.
- Removed WAV from the service-worker precache glob.
- Added a larger, touch-friendly seek control and reduced-motion support.

## Files changed
- `README.md`
- `SETUP-SYNC.md`
- `vite.config.ts`
- `src/sw.ts`
- `src/styles.css`
- `src/lib/nightjar/catalog.ts`
- `src/lib/nightjar/store.ts`
- `src/lib/nightjar/sync.ts`
- `src/components/nightjar/parts.tsx`
- `src/components/nightjar/settings.tsx`
- `src/components/nightjar/shell.tsx`
- `src/components/nightjar/views.tsx`

## Files removed
- `scripts/make_sample_songs.py`
- `public/audio/*.wav` (six demo tracks)
- `public/covers/{field-notes,glass-hours,last-train,low-light}.jpg`

## Verification performed
- Parsed all 27 TypeScript/TSX source files with the installed TypeScript compiler API: syntax passed.
- Ran source-level checks for removed demo catalogue references and key fix patterns.
- Full `npm ci`, TypeScript semantic checks and Vite production build were **not completed** because dependency installation timed out in this environment. An offline install also failed because the required package tarballs were not cached.
- No browser, real-device, Firebase or Google Drive runtime tests were performed here.

## Required checks before merge/deploy
Run from the project root:

```bash
npm ci
npm run typecheck
npm run build
```

Then manually verify:
1. A fresh install opens to an empty library with no demo albums.
2. Import several tracks; they appear in Home, Songs, Albums and Artists.
3. Seek with mouse, touch, keyboard, pointer cancellation and after a track change.
4. Open More → Settings; browser/Android Back and the Settings back control both return to Listening Room.
5. Sign out and sign into a different Google account; the previous account's Drive token must not be reused.
6. Simulate Firestore write rejection and confirm song/playlist retries.
7. Fail one file during Download All; remaining files continue, progress remains accurate, and failed files can be retried.
8. Complete Drive backup; ensure the Drive file ID is only considered synced after Firestore confirms it.
9. Verify offline playback after downloading/importing tracks.
10. Run two-device sync tests and confirm playlists, metadata and local files are not lost.

## Important limitations
- The uploaded ZIP does not contain `.git` metadata, so its exact Git commit cannot be cryptographically verified from the archive itself. The code snapshot was treated as the baseline supplied by the user.
- The changes above are concrete code improvements, not a claim that every previously discussed issue is solved. In particular, the premium visual redesign still needs a browser-based design review, and audio codec, performance, PWA and cloud runtime behaviour require real-device testing.
- Do not overwrite production or deploy until the checks above pass. Keep a backup of the current `main` branch and do not remove any user data during migration.

---

## Merge into `main` (30 Oct 2026): verification and integration fixes

Baseline: `main` at `8e43b70` (tagged `backup/pre-handoff-2026-10-30`). The ZIP tree matched `main` except for the files listed above; the patch and ZIP agree (the patch's README hunk lacks a trailing newline, so the ZIP copy was used).
Untouched: `src/firebase-config.ts`, `api/` (Vercel Drive helper), `firestore.rules`, `drive.ts`, `sync-state.ts`, `account.tsx`, manifest, callback page, `package.json`, `package-lock.json`, workflow. Vercel environment variables live in Vercel, not in the repo.

### Integration fixes made during the merge
1. `shell.tsx`: added the missing `initNavigation` import (the supplied code did not compile).
2. `parts.tsx` SeekBar: arrow keys now jump ±5 s (Page Up/Down ±10 s). With the new 0.05 s step, arrow presses moved less than the position display's 0.05 s update threshold and snapped back, so keyboard seeking did nothing. Home/End unchanged.
3. `sync.ts` Download all: removed the leftover second completion toast; the early stop now only happens when Drive can't renew silently (so the always-connected helper isn't cut short by one failure).
4. `sync.ts` playlists: saves and deletions are handed to Firestore immediately, in order (Firestore persists the queue offline). The supplied in-flight guard dropped a deletion made while an earlier save was pending (e.g. edit then delete offline), so the playlist would reappear on other devices. Confirmed-only remote map and bounded retries are kept; the map never moves backwards in time.
5. `sync.ts` songs: song records are queued to Firestore immediately instead of one awaited write at a time (which stalled while offline and was slow for large imports). Still added to the remote map only after Firestore confirms; bounded retries kept; backup re-runs when songs are confirmed during a run.
6. `views.tsx`: the Home drop hint no longer says "nothing is uploaded" (matches the README wording about optional Drive backup).

### Results
- `npm ci` ✅ · `npm run typecheck` (app, service worker, API) ✅ · `npm run build` ✅ (offline precache 19.8 MB → 0.8 MB)
- New behaviour suite: 31/31 (empty library and empty states, import, Artist page, mouse/keyboard/pointer-cancel/after-track-change seeking, browser Back and Settings back, Firestore write rejection then retry, Drive IDs only after confirmation, offline edit+delete reaching the other device, Download all with one failing file and retry, sign-out clears Drive key, offline playback)
- Update from the previous version: 10/10 (imported songs, playlists and settings kept; demo songs drop out cleanly; old demo audio removed from the offline cache; update waits for Reload)
- Earlier suites: two-device sync 15/15, always-connected Drive 13/13, Vercel helper API 8/8
- Not covered here: real Google sign-in/Drive on real devices (tested against Firebase emulators and a simulated Drive).
