// Account sync: Google sign-in (Firebase Auth), live sync of playlists / settings / song list (Firestore),
// and song files backed up to your own Google Drive.
//
// Cloud layout (only you can read or write it, see firestore.rules):
//   users/{uid}                 { settings, settingsUpdatedAt, backup }
//   users/{uid}/songs/{songKey} song details + small cover + driveId
//   users/{uid}/playlists/{id}  { name, songs: [songKey], createdAt, updatedAt, deleted }
import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
  type UserCredential,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  type Firestore,
  type SnapshotMetadata,
  type Unsubscribe,
} from "firebase/firestore";
import { googleClientId, useEmulators } from "@/firebase-config";
import { DRIVE_SCOPE, DriveAuthError, clearDriveToken, downloadSong, driveToken, getDriveToken, setDriveToken, setTokenRefresher, uploadSong } from "./drive";
import { idbGet } from "./idb";
import { coverThumb, sameSong } from "./songkey";
import {
  downloadTrack,
  ensureSongKeys,
  getState,
  setCloudTracks,
  setPlaylistsFromRemote,
  setSettingsFromRemote,
  settingsUpdatedAt,
  syncHooks,
  toast,
  type SyncedSettings,
} from "./store";
import { getSync, setSync } from "./sync-state";
import type { AudioSpec, Playlist, Track } from "./types";

type RemoteSong = {
  title: string;
  artist: string;
  album: string;
  albumId: string;
  trackNumber: number;
  duration: number;
  format: AudioSpec;
  bytes: number | null;
  fileName: string | null;
  year?: number | null;
  glow: string;
  art: string | null;
  addedAt: number;
  updatedAt: number;
  driveId: string | null;
};
type RemotePlaylist = { name: string; songs: string[]; createdAt: number; updatedAt: number; deleted?: boolean };
type RemoteUser = { settings?: SyncedSettings; settingsUpdatedAt?: number; backup?: boolean; driveSealed?: string | null };

let auth: Auth;
let db: Firestore;
let uid: string | null = null;
let unsubs: Unsubscribe[] = [];
const remoteSongs = new Map<string, RemoteSong>();
const remotePlaylists = new Map<string, RemotePlaylist>();
/** Songs in a synced playlist that this device can't show yet; kept so they aren't dropped on save. */
const unresolved = new Map<string, string[]>();
const writingSongs = new Set<string>();
let userDoc: RemoteUser = {};
let songsLoaded = false;
let playlistsLoaded = false;
const pending = { user: false, songs: false, playlists: false };
/** The always-connected Drive helper (Vercel functions) answers on this site. */
let helper = false;
/** A Google window for Drive is open; downloads wait for it instead of failing. */
let connecting = false;
let consentState: string | null = null;

/* ------------------------------------------------------------------ */
/* Start + sign-in                                                     */
/* ------------------------------------------------------------------ */

function provider(email?: string | null) {
  const p = new GoogleAuthProvider();
  p.addScope(DRIVE_SCOPE);
  if (email) p.setCustomParameters({ login_hint: email });
  return p;
}

function keepToken(cred: UserCredential | null) {
  const token = cred ? GoogleAuthProvider.credentialFromResult(cred)?.accessToken : null;
  connecting = false;
  if (token) {
    setDriveToken(token);
    setSync({ driveConnected: true });
    void runBackup();
  } else if (cred && useEmulators) {
    // The local test server has no real Google; pretend Drive is connected so the flow can be tested.
    setDriveToken("emulator-token");
    setSync({ driveConnected: true });
    void runBackup();
  }
}

function friendly(e: unknown) {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "auth/network-request-failed") return "No internet connection. Try again when you’re online.";
  if (code === "auth/unauthorized-domain") return "This web address isn’t allowed yet. Add it in Firebase → Authentication → Settings → Authorized domains.";
  if (code === "auth/user-mismatch") return "Pick the same Google account you signed in with.";
  if (code === "auth/operation-not-allowed") return "Google sign-in is turned off. Turn it on in Firebase → Authentication → Sign-in method.";
  return "Sign-in didn’t work. Please try again.";
}

export function start(config: FirebaseOptions) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  setSync({ driveConnected: Boolean(driveToken()) });
  void getRedirectResult(auth).then(keepToken).catch(() => {});
  setTokenRefresher(renewViaHelper);
  // The helper only runs on the Vercel site; GitHub Pages can't host it.
  if (!location.hostname.endsWith("github.io")) void fetch("api/drive/status", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { configured?: boolean } | null) => {
      helper = Boolean(d?.configured);
      refreshDriveState();
    })
    .catch(() => {});
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data?.type === "nightjar-drive") void finishConsent(e.data);
  });
  window.addEventListener("storage", (e) => {
    if (e.key === "nightjar.driveConsent" && e.newValue) void finishConsent(JSON.parse(e.newValue));
  });
  document.addEventListener("visibilitychange", checkStoredConsent);
  window.addEventListener("focus", checkStoredConsent);
  onAuthStateChanged(auth, (user) => (user ? void attach(user) : detach()));
  window.addEventListener("online", refreshStatus);
  window.addEventListener("offline", refreshStatus);
}

/** Opens Google's sign-in window. Call straight from a tap. */
export function signIn() {
  setSync({ status: "signing-in", message: null });
  signInWithPopup(auth, provider())
    .then(keepToken)
    .catch((e) => {
      const code = (e as { code?: string })?.code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        void signInWithRedirect(auth, provider());
        return;
      }
      const cancelled = code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
      setSync({ status: "signed-out", message: cancelled ? null : friendly(e) });
    });
}

/** Google's Drive access lasts about an hour; this renews it. Call straight from a tap. */
export function connectDrive() {
  const user = auth.currentUser;
  if (!user) return;
  connecting = true;
  if (helper) {
    startConsent(user.email);
    return;
  }
  reauthenticateWithPopup(user, provider(user.email))
    .then(keepToken)
    .catch((e) => {
      connecting = false;
      const code = (e as { code?: string })?.code ?? "";
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") toast(friendly(e));
    });
}

/* ------------------------------------------------------------------ */
/* Always-connected Drive (helper on Vercel)                           */
/* ------------------------------------------------------------------ */

const canRenewSilently = () => helper && Boolean(userDoc.driveSealed);

function refreshDriveState() {
  setSync({ helper, alwaysConnected: canRenewSilently(), driveConnected: Boolean(driveToken()) || canRenewSilently() });
}

/** One Google window, once: "let Nightjar keep using your Drive files". Must run straight from a tap. */
function startConsent(email: string | null) {
  consentState = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: new URL("drive-callback.html", location.href).href.split("?")[0],
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: consentState,
  });
  if (email) params.set("login_hint", email);
  try {
    localStorage.removeItem("nightjar.driveConsent");
  } catch {
    /* ignore */
  }
  const w = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, "nightjar-drive", "popup,width=500,height=680");
  if (!w) {
    connecting = false;
    toast("Your browser blocked the Google window. Allow pop-ups for Nightjar and try again.");
  }
  window.setTimeout(() => {
    connecting = false;
  }, 3 * 60_000);
}

function checkStoredConsent() {
  if (!consentState) return;
  try {
    const raw = localStorage.getItem("nightjar.driveConsent");
    if (raw) void finishConsent(JSON.parse(raw));
  } catch {
    /* ignore */
  }
}

async function finishConsent(data: { code?: string | null; state?: string | null; error?: string | null }) {
  if (!consentState || data.state !== consentState) return;
  consentState = null;
  try {
    localStorage.removeItem("nightjar.driveConsent");
  } catch {
    /* ignore */
  }
  const user = auth.currentUser;
  if (data.error || !data.code || !user) {
    connecting = false;
    if (data.error && data.error !== "access_denied") toast("Google Drive wasn’t connected. Please try again.");
    return;
  }
  try {
    const res = await fetch("api/drive/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: data.code, redirectUri: new URL("drive-callback.html", location.href).href.split("?")[0], idToken: await user.getIdToken() }),
    });
    const out = (await res.json()) as { access_token?: string; expires_in?: number; sealed?: string; error?: string };
    if (out.access_token) setDriveToken(out.access_token, Math.max(60, (out.expires_in ?? 3600) - 300));
    if (out.sealed && uid) {
      userDoc = { ...userDoc, driveSealed: out.sealed };
      await setDoc(doc(db, "users", uid), { driveSealed: out.sealed }, { merge: true });
      toast("Google Drive will now stay connected on all your devices");
    } else if (out.access_token) {
      toast("Drive connected for an hour. To keep it connected, remove Nightjar at myaccount.google.com/permissions and connect again.");
    } else {
      toast("Google Drive wasn’t connected. Please try again.");
    }
  } catch {
    toast("Couldn’t finish connecting Google Drive. Check your internet and try again.");
  } finally {
    connecting = false;
    refreshDriveState();
    void runBackup();
  }
}

/** Ask the helper for a fresh one-hour key. No popup. */
async function renewViaHelper(): Promise<string | null> {
  const user = auth?.currentUser;
  if (!canRenewSilently() || !user || !navigator.onLine) return null;
  try {
    const res = await fetch("api/drive/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sealed: userDoc.driveSealed, idToken: await user.getIdToken() }),
    });
    const out = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (out.access_token) {
      setDriveToken(out.access_token, Math.max(60, (out.expires_in ?? 3600) - 300));
      setSync({ driveConnected: true });
      return out.access_token;
    }
    if (out.error === "reconnect" && uid) {
      // You removed Nightjar's access in your Google account (or the key changed): one tap reconnects.
      userDoc = { ...userDoc, driveSealed: null };
      void setDoc(doc(db, "users", uid), { driveSealed: null }, { merge: true });
      refreshDriveState();
    }
  } catch {
    /* offline or helper unreachable: try again later */
  }
  return null;
}

/** Wait for a Drive key while a Google window is open (up to a limit). */
async function waitForToken(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until && connecting) {
    await new Promise((r) => setTimeout(r, 500));
    const t = driveToken();
    if (t) return t;
  }
  return driveToken();
}

/** From a tap on a Drive-only song: renew Drive access now if it can't renew by itself. */
function beforeCloudPlay() {
  if (!uid || driveToken() || canRenewSilently() || connecting) return;
  connectDrive();
}

/** "Download all to this phone": every song in your Drive, one by one. Call from a tap. */
export function downloadAll() {
  const list = getState().tracks.filter((t) => t.storage === "cloud" && ((t.songKey && remoteSongs.get(t.songKey)?.driveId) || t.driveId));
  if (!list.length || getSync().downloadingAll) return;
  beforeCloudPlay();
  void (async () => {
    let done = 0;
    setSync({ downloadingAll: { done, total: list.length } });
    for (const t of list) {
      const ok = await downloadTrack(t.id, true);
      if (!ok) {
        toast(driveToken() ? `Couldn’t download “${t.title}”. Stopped; tap Download all to retry.` : "Download paused: Google Drive needs connecting (Settings).");
        break;
      }
      done++;
      setSync({ downloadingAll: { done, total: list.length } });
    }
    setSync({ downloadingAll: null });
    if (done === list.length) toast(`All ${done} songs are now on this device`);
  })();
}

export function signOutOfAccount() {
  clearDriveToken();
  setSync({ driveConnected: false });
  void signOut(auth);
}

export function setBackup(on: boolean) {
  if (!uid) return;
  if (on && !driveToken() && !canRenewSilently()) connectDrive();
  setSync({ backup: on });
  void setDoc(doc(db, "users", uid), { backup: on }, { merge: true });
}

export function backupNow() {
  if (!driveToken() && !canRenewSilently()) {
    connectDrive();
    return;
  }
  void runBackup();
}

/* ------------------------------------------------------------------ */
/* Live sync                                                           */
/* ------------------------------------------------------------------ */

function refreshStatus() {
  if (!uid) return;
  const s = getSync();
  if (s.status === "error") return;
  const busy = pending.user || pending.songs || pending.playlists || Boolean(s.uploading);
  setSync({ status: !navigator.onLine ? "offline" : busy || !songsLoaded || !playlistsLoaded ? "syncing" : "synced" });
}

function track(part: keyof typeof pending, meta: SnapshotMetadata) {
  pending[part] = meta.hasPendingWrites;
  refreshStatus();
}

function onError(e: unknown) {
  const code = (e as { code?: string })?.code ?? "";
  setSync({
    status: "error",
    message:
      code === "permission-denied"
        ? "Sync is blocked by your database rules. Paste the rules from the setup guide into Firebase → Firestore → Rules."
        : "Sync stopped because of an error. Reopen the app to try again.",
  });
}

async function attach(user: User) {
  detach(false);
  uid = user.uid;
  setSync({
    user: { name: user.displayName ?? user.email ?? "You", email: user.email ?? "", photo: user.photoURL },
    status: "syncing",
    message: null,
  });
  try {
    await ensureSongKeys();
  } catch {
    /* older imports just won't sync until next start */
  }
  if (uid !== user.uid) return;
  const base = `users/${uid}`;
  unsubs.push(
    onSnapshot(
      doc(db, base),
      { includeMetadataChanges: true },
      (snap) => {
        userDoc = (snap.data() as RemoteUser | undefined) ?? {};
        track("user", snap.metadata);
        applyUser(snap.metadata.fromCache);
      },
      onError,
    ),
  );
  unsubs.push(
    onSnapshot(
      collection(db, base, "songs"),
      { includeMetadataChanges: true },
      (snap) => {
        for (const c of snap.docChanges()) {
          if (c.type === "removed") remoteSongs.delete(c.doc.id);
          else remoteSongs.set(c.doc.id, c.doc.data() as RemoteSong);
        }
        songsLoaded = true;
        track("songs", snap.metadata);
        if (snap.docChanges().length || !snap.metadata.fromCache) {
          rebuild();
          void pushSongs();
        }
      },
      onError,
    ),
  );
  unsubs.push(
    onSnapshot(
      collection(db, base, "playlists"),
      { includeMetadataChanges: true },
      (snap) => {
        for (const c of snap.docChanges()) {
          if (c.type === "removed") remotePlaylists.delete(c.doc.id);
          else remotePlaylists.set(c.doc.id, c.doc.data() as RemotePlaylist);
        }
        const first = !playlistsLoaded;
        playlistsLoaded = true;
        track("playlists", snap.metadata);
        if (first || snap.docChanges().length) applyPlaylists();
      },
      onError,
    ),
  );

  syncHooks.playlistsChanged = (changed, deleted) => {
    if (!uid || !playlistsLoaded) return;
    changed.forEach(writePlaylist);
    deleted.forEach(writeTombstone);
  };
  syncHooks.settingsChanged = (settings, at) => {
    if (uid) void setDoc(doc(db, "users", uid), { settings, settingsUpdatedAt: at }, { merge: true });
  };
  syncHooks.tracksChanged = () => {
    if (!uid || !songsLoaded) return;
    rebuild();
    void pushSongs();
  };
  syncHooks.downloadCloud = download;
  syncHooks.beforeCloudPlay = beforeCloudPlay;
  syncHooks.inCloud = (key) => {
    const r = remoteSongs.get(key);
    return r ? { driveId: r.driveId ?? null } : null;
  };
}

function detach(announce = true) {
  unsubs.forEach((u) => u());
  unsubs = [];
  uid = null;
  remoteSongs.clear();
  remotePlaylists.clear();
  unresolved.clear();
  songsLoaded = playlistsLoaded = false;
  userDoc = {};
  syncHooks.playlistsChanged = syncHooks.settingsChanged = syncHooks.tracksChanged = undefined;
  syncHooks.downloadCloud = undefined;
  syncHooks.beforeCloudPlay = undefined;
  syncHooks.inCloud = undefined;
  if (announce) {
    setCloudTracks([], new Map());
    setSync({ user: null, status: "signed-out", backup: false, songsInAccount: 0, songsBackedUp: 0, songsWaiting: 0, uploading: null });
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function applyUser(fromCache: boolean) {
  const remoteAt = userDoc.settingsUpdatedAt ?? 0;
  const localAt = settingsUpdatedAt();
  if (userDoc.settings && remoteAt > localAt) setSettingsFromRemote(userDoc.settings, remoteAt);
  else if (!fromCache && localAt > remoteAt && uid) {
    const s = getState();
    void setDoc(doc(db, "users", uid), { settings: { crossfade: s.crossfade, eqOn: s.eqOn, eqGains: s.eqGains }, settingsUpdatedAt: localAt }, { merge: true });
  }
  if (Boolean(userDoc.backup) !== getSync().backup) setSync({ backup: Boolean(userDoc.backup) });
  refreshDriveState();
  void runBackup();
}

/* ------------------------------------------------------------------ */
/* Songs                                                               */
/* ------------------------------------------------------------------ */

const keyOf = (t: Track | undefined) => (t ? t.songKey ?? (t.storage === "catalog" ? `catalog:${t.id}` : null) : null);
const isSynthetic = (t: Track) => t.storage === "cloud" && t.id.startsWith("cloud-");

function toTrack(key: string, r: RemoteSong): Track {
  return {
    id: `cloud-${key}`,
    title: r.title,
    artist: r.artist,
    album: r.album,
    albumId: r.albumId,
    trackNumber: r.trackNumber ?? 0,
    duration: r.duration ?? 0,
    src: null,
    artwork: r.art ?? null,
    glow: r.glow ?? "#c45c26",
    format: r.format,
    bytes: r.bytes ?? null,
    addedAt: r.addedAt ?? 0,
    fileName: r.fileName ?? null,
    liner: null,
    storage: "cloud",
    hasEmbeddedArt: false,
    playback: "ready",
    playbackNote: r.driveId
      ? "In your Google Drive. It downloads to this device the first time you play it."
      : "Saved in your account, but the file is only on your other device. Turn on song backup there.",
    fingerprint: null,
    year: r.year ?? undefined,
    songKey: key,
    driveId: r.driveId ?? null,
  };
}

/** Show songs that are in your account but not on this phone. */
function rebuild() {
  const tracks = getState().tracks;
  const present = new Set(tracks.filter((t) => !isSynthetic(t)).map((t) => t.songKey).filter(Boolean));
  const locals = tracks.filter((t) => t.storage === "local");
  const cloud: Track[] = [];
  const driveIds = new Map<string, string | null>();
  let backedUp = 0;
  for (const [key, r] of remoteSongs) {
    driveIds.set(key, r.driveId ?? null);
    if (r.driveId) backedUp++;
    if (present.has(key)) continue;
    if (locals.some((l) => sameSong(l, r))) continue; // same song as a different file here (e.g. MP3 vs FLAC)
    cloud.push(toTrack(key, r));
  }
  setCloudTracks(cloud, driveIds);
  setSync({ songsInAccount: remoteSongs.size, songsBackedUp: backedUp });
  if (playlistsLoaded) applyPlaylists();
}

/** Add songs from this phone to your account's song list. */
async function pushSongs() {
  if (!uid || !songsLoaded) return;
  const me = uid;
  const locals = getState().tracks.filter((t) => t.storage === "local" && t.songKey && !remoteSongs.has(t.songKey) && !writingSongs.has(t.songKey));
  for (const t of locals) {
    const key = t.songKey!;
    writingSongs.add(key);
    try {
      let art: string | null = null;
      if (t.hasEmbeddedArt) {
        const blob = await idbGet(`art:${t.id}`);
        if (blob) art = await coverThumb(blob);
      }
      const now = Date.now();
      const song: RemoteSong = {
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumId: t.albumId,
        trackNumber: t.trackNumber,
        duration: t.duration,
        format: t.format,
        bytes: t.bytes,
        fileName: t.fileName,
        year: t.year ?? null,
        glow: t.glow,
        art,
        addedAt: t.addedAt,
        updatedAt: now,
        driveId: null,
      };
      if (uid !== me) return;
      remoteSongs.set(key, song);
      void setDoc(doc(db, "users", me, "songs", key), song).finally(() => writingSongs.delete(key));
    } catch {
      writingSongs.delete(key);
    }
  }
  void runBackup();
}

let backingUp = false;
/** Upload this phone's songs to your Google Drive (when backup is on). */
async function runBackup() {
  if (!uid) return;
  const waiting = () =>
    getState().tracks.filter((t) => t.storage === "local" && t.songKey && remoteSongs.has(t.songKey) && !remoteSongs.get(t.songKey)!.driveId);
  const count = userDoc.backup ? waiting().length : 0;
  setSync({ songsWaiting: count, driveConnected: Boolean(driveToken()) || canRenewSilently() });
  if (!userDoc.backup || backingUp || !count) return;
  backingUp = true;
  const token = await getDriveToken();
  backingUp = false;
  if (!token) {
    setSync({ driveConnected: false });
    return;
  }
  backingUp = true;
  const me = uid;
  try {
    for (const t of waiting()) {
      if (uid !== me || !userDoc.backup) break;
      const key = t.songKey!;
      if (remoteSongs.get(key)?.driveId) continue;
      const blob = await idbGet(`audio:${t.id}`);
      if (!blob) continue;
      setSync({ uploading: t.title });
      refreshStatus();
      const ext = t.fileName?.match(/\.[^.]+$/)?.[0] ?? "";
      const driveId = await uploadSong(blob, t.fileName ?? `${t.artist} - ${t.title}${ext}`, key);
      const r = remoteSongs.get(key);
      if (r) remoteSongs.set(key, { ...r, driveId });
      await setDoc(doc(db, "users", me, "songs", key), { driveId, updatedAt: Date.now() }, { merge: true });
      setSync({ songsWaiting: waiting().length });
    }
  } catch (e) {
    if (e instanceof DriveAuthError) setSync({ driveConnected: false });
    else toast("Song backup paused: couldn’t reach Google Drive. It will retry later.");
  } finally {
    backingUp = false;
    setSync({ uploading: null, songsWaiting: userDoc.backup ? waiting().length : 0 });
    refreshStatus();
  }
}

async function download(t: Track, quiet: boolean): Promise<Blob | null> {
  const driveId = (t.songKey && remoteSongs.get(t.songKey)?.driveId) || t.driveId;
  if (!driveId) {
    if (!quiet) toast(`“${t.title}” is only on your other device. Turn on song backup there to play it here.`);
    return null;
  }
  const token = (await getDriveToken()) ?? (connecting ? await waitForToken(120_000) : null);
  if (!token) {
    setSync({ driveConnected: false });
    if (!quiet) toast(`Tap “Connect Google Drive” in Settings to download “${t.title}”.`);
    return null;
  }
  try {
    return await downloadSong(driveId);
  } catch (e) {
    if (e instanceof DriveAuthError) setSync({ driveConnected: false });
    if (!quiet) toast(e instanceof DriveAuthError ? "Google Drive needs reconnecting (Settings)." : `Couldn’t download “${t.title}”.`);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Playlists                                                           */
/* ------------------------------------------------------------------ */

function resolver() {
  const tracks = getState().tracks;
  const byKey = new Map<string, string>();
  for (const t of tracks) {
    const k = keyOf(t);
    if (k && (!byKey.has(k) || !isSynthetic(t))) byKey.set(k, t.id);
  }
  const locals = tracks.filter((t) => t.storage === "local");
  return (key: string): string | null => {
    const direct = byKey.get(key);
    if (direct) return direct;
    const r = remoteSongs.get(key);
    const twin = r && locals.find((l) => sameSong(l, r));
    return twin ? twin.id : null;
  };
}

function fromRemote(id: string, r: RemotePlaylist, resolve: (k: string) => string | null): Playlist {
  const trackIds: string[] = [];
  const missing: string[] = [];
  for (const key of r.songs ?? []) {
    const tid = resolve(key);
    if (tid && !trackIds.includes(tid)) trackIds.push(tid);
    else if (!tid) missing.push(key);
  }
  unresolved.set(id, missing);
  return { id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, trackIds };
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function applyPlaylists() {
  const resolve = resolver();
  const local = getState().playlists;
  const known = new Set(local.map((p) => p.id));
  const result: Playlist[] = [];
  const upload: Playlist[] = [];
  let changed = false;
  for (const p of local) {
    const r = remotePlaylists.get(p.id);
    const localAt = p.updatedAt ?? p.createdAt;
    if (!r) {
      upload.push(p);
      result.push(p);
    } else if (localAt > r.updatedAt) {
      upload.push(p);
      result.push(p);
    } else if (r.deleted) {
      changed = true; // deleted on another device
    } else {
      const np = fromRemote(p.id, r, resolve);
      if (np.name !== p.name || !sameIds(np.trackIds, p.trackIds) || np.updatedAt !== p.updatedAt) {
        result.push(np);
        changed = true;
      } else result.push(p);
    }
  }
  for (const [id, r] of remotePlaylists) {
    if (!known.has(id) && !r.deleted) {
      result.push(fromRemote(id, r, resolve));
      changed = true;
    }
  }
  if (changed) setPlaylistsFromRemote(result.sort((a, b) => a.createdAt - b.createdAt));
  upload.forEach(writePlaylist);
}

function writePlaylist(p: Playlist) {
  if (!uid) return;
  const tracks = getState().tracks;
  const keys = p.trackIds.map((id) => keyOf(tracks.find((t) => t.id === id))).filter((k): k is string => Boolean(k));
  for (const k of unresolved.get(p.id) ?? []) if (!keys.includes(k)) keys.push(k);
  const data: RemotePlaylist = { name: p.name, songs: keys, createdAt: p.createdAt, updatedAt: p.updatedAt ?? Date.now(), deleted: false };
  remotePlaylists.set(p.id, data);
  void setDoc(doc(db, "users", uid, "playlists", p.id), data);
}

function writeTombstone(id: string) {
  if (!uid) return;
  const data: RemotePlaylist = { name: "", songs: [], createdAt: remotePlaylists.get(id)?.createdAt ?? Date.now(), updatedAt: Date.now(), deleted: true };
  remotePlaylists.set(id, data);
  unresolved.delete(id);
  void setDoc(doc(db, "users", uid, "playlists", id), data);
}
