import { useMemo } from "react";
import { formatBytes } from "@/lib/nightjar/format";
import { useStore } from "@/lib/nightjar/store";
import { backupNow, connectDrive, downloadAll, setBackup, signIn, signOutOfAccount, useSync } from "@/lib/nightjar/sync-state";

const STATUS: Record<string, { text: string; tone: "good" | "busy" | "bad" | "" }> = {
  loading: { text: "Starting…", tone: "busy" },
  "signed-out": { text: "Not signed in", tone: "" },
  "signing-in": { text: "Signing in…", tone: "busy" },
  syncing: { text: "Syncing…", tone: "busy" },
  synced: { text: "Up to date", tone: "good" },
  offline: { text: "Offline · changes sync when you’re back online", tone: "" },
  error: { text: "Sync problem", tone: "bad" },
};

export function AccountCard() {
  const s = useSync();
  const tracks = useStore((st) => st.tracks);
  const cloud = useMemo(() => tracks.filter((t) => t.storage === "cloud" && t.driveId), [tracks]);
  const cloudBytes = cloud.reduce((n, t) => n + (t.bytes || 0), 0);
  if (!s.configured) {
    return (
      <section className="nj-card">
        <h2 className="nj-h3">Account &amp; sync</h2>
        <p className="nj-muted nj-small">Sync isn’t set up in this copy of Nightjar yet. Everything works on this device without an account.</p>
      </section>
    );
  }
  const st = STATUS[s.status] ?? STATUS.loading;
  return (
    <section className="nj-card">
      <h2 className="nj-h3">Account &amp; sync</h2>
      {!s.user ? (
        <>
          <p className="nj-muted nj-small">
            Sign in with Google to keep your playlists, equalizer and song list the same on all your devices. Songs can be backed up to a “Nightjar Music” folder in your own Google Drive.
          </p>
          <div className="nj-row">
            <button className="nj-btn nj-btn-primary" onClick={() => signIn()} disabled={s.status === "loading" || s.status === "signing-in"}>
              {s.status === "signing-in" ? "Signing in…" : "Sign in with Google"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="nj-account">
            {s.user.photo ? <img src={s.user.photo} alt="" referrerPolicy="no-referrer" /> : <span className="nj-avatar">{s.user.name.slice(0, 1).toUpperCase()}</span>}
            <div className="nj-song-text">
              <span className="nj-song-title">{s.user.name}</span>
              <span className="nj-song-sub">{s.user.email}</span>
            </div>
          </div>
          <p className="nj-small" style={{ margin: 0 }}>
            <span className={`nj-sync-dot ${st.tone ? `is-${st.tone}` : ""}`} />
            {st.text}
          </p>
          <dl className="nj-facts">
            <div><dt>Songs in your account</dt><dd>{s.songsInAccount}</dd></div>
            <div><dt>Backed up to Google Drive</dt><dd>{s.songsBackedUp}</dd></div>
            {s.backup && <div><dt>Waiting to back up from this device</dt><dd>{s.songsWaiting}</dd></div>}
          </dl>
          <dl className="nj-facts">
            <div>
              <dt>Google Drive</dt>
              <dd>{s.alwaysConnected ? "Always connected ✓" : s.driveConnected ? "Connected (renews when you tap)" : "Needs connecting"}</dd>
            </div>
          </dl>
          <label className="nj-switch">
            <input type="checkbox" checked={s.backup} onChange={(e) => setBackup(e.target.checked)} />
            Back up my songs to Google Drive
          </label>
          {s.uploading && (
            <p className="nj-muted nj-small" style={{ margin: 0 }}>
              Uploading “{s.uploading}”{s.uploadPct !== null ? ` · ${Math.round(s.uploadPct * 100)}%` : "…"}
            </p>
          )}
          {s.backup && s.songsWaiting > 0 && (
            <p className="nj-muted nj-small" style={{ margin: 0 }}>
              Keep Nightjar open (on Wi-Fi) until this reaches 0. Phones pause uploads when the app is closed; the screen stays on while uploading.
            </p>
          )}
          {s.backupError && <p className="nj-error" style={{ margin: 0 }}>Backup problem: {s.backupError}</p>}
          {s.downloadingAll && (
            <p className="nj-muted nj-small" style={{ margin: 0 }}>
              Downloading to this phone: {s.downloadingAll.done} of {s.downloadingAll.total}…
            </p>
          )}
          <div className="nj-row">
            {s.helper && !s.alwaysConnected && (
              <button className="nj-btn nj-btn-primary" onClick={() => connectDrive()}>
                Keep Google Drive connected
              </button>
            )}
            {!s.helper && !s.driveConnected && (
              <button className="nj-btn nj-btn-primary" onClick={() => connectDrive()}>
                Connect Google Drive
              </button>
            )}
            {cloud.length > 0 && !s.downloadingAll && (
              <button className="nj-btn" onClick={() => downloadAll()}>
                Download all to this phone ({cloud.length}
                {cloudBytes ? ` · ${formatBytes(cloudBytes)}` : ""})
              </button>
            )}
            {s.driveConnected && s.backup && s.songsWaiting > 0 && !s.uploading && (
              <button className="nj-btn" onClick={() => backupNow()}>
                Back up now
              </button>
            )}
            <button className="nj-btn" onClick={() => signOutOfAccount()}>
              Sign out
            </button>
          </div>
          <p className="nj-muted nj-small" style={{ margin: 0 }}>
            {s.alwaysConnected
              ? "Drive renews by itself in the background on all your devices. Nightjar can only see the files it made."
              : s.helper
                ? "Tap “Keep Google Drive connected” once and Drive renews by itself from then on, on all your devices."
                : "Google only lets Nightjar into Drive for an hour at a time; it renews when you tap a song. Nightjar can only see the files it made."}
          </p>
        </>
      )}
      {s.message && <p className="nj-error">{s.message}</p>}
    </section>
  );
}
