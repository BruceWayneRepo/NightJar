// Google Drive: your songs are backed up to a "Nightjar Music" folder in your own Drive.
// Uses the drive.file permission, so Nightjar can only see files it created itself.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_KEY = "nightjar.driveToken";
const FOLDER_NAME = "Nightjar Music";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export class DriveAuthError extends Error {}

let token: { value: string; exp: number } | null = (() => {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    const t = raw ? (JSON.parse(raw) as { value: string; exp: number }) : null;
    return t && t.exp > Date.now() ? t : null;
  } catch {
    return null;
  }
})();

/** Google gives an access key that lasts about an hour. */
export function setDriveToken(value: string, ttlSeconds = 3300) {
  token = { value, exp: Date.now() + ttlSeconds * 1000 };
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    /* ignore */
  }
}

export function clearDriveToken() {
  token = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function driveToken() {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  return null;
}

/* Silent renewal: when the always-connected helper is set up, sync.ts plugs in a function that
   gets a fresh access key from it without any popup. */
let refresher: (() => Promise<string | null>) | null = null;
let refreshing: Promise<string | null> | null = null;
export function setTokenRefresher(fn: (() => Promise<string | null>) | null) {
  refresher = fn;
}

/** A working access key: the current one, or a new one from the helper. Null if a tap is needed. */
export async function getDriveToken(): Promise<string | null> {
  const t = driveToken();
  if (t) return t;
  if (!refresher) return null;
  refreshing ??= refresher()
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function call(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const t = await getDriveToken();
  if (!t) throw new DriveAuthError("Google Drive isn't connected");
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  if (res.status === 401) {
    clearDriveToken();
    if (!retried && refresher) return call(url, init, true);
    throw new DriveAuthError("Google Drive access expired");
  }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

const q = (s: string) => encodeURIComponent(s);

let folderPromise: Promise<string> | null = null;
/** Find or create the "Nightjar Music" folder. */
export function ensureFolder(): Promise<string> {
  folderPromise ??= (async () => {
    const query = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const found = (await (await call(`${API}/files?q=${q(query)}&fields=files(id)&spaces=drive`)).json()) as { files: { id: string }[] };
    if (found.files[0]) return found.files[0].id;
    const made = (await (
      await call(`${API}/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
      })
    ).json()) as { id: string };
    return made.id;
  })().catch((e) => {
    folderPromise = null;
    throw e;
  });
  return folderPromise;
}

/** Already uploaded from another device? */
async function findByKey(songKey: string) {
  const query = `appProperties has { key='nightjarKey' and value='${songKey}' } and trashed=false`;
  const res = (await (await call(`${API}/files?q=${q(query)}&fields=files(id)&spaces=drive`)).json()) as { files: { id: string }[] };
  return res.files[0]?.id ?? null;
}

/** Send the file to the upload address Google gave us, reporting progress (big lossless files take a while). */
function putFile(url: string, blob: Blob, type: string, token: string, onProgress?: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", type);
    x.setRequestHeader("Authorization", `Bearer ${token}`);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    x.onload = () => {
      if (x.status === 401) {
        clearDriveToken();
        reject(new DriveAuthError("Google Drive access expired"));
      } else if (x.status >= 200 && x.status < 300) {
        try {
          resolve((JSON.parse(x.responseText) as { id: string }).id);
        } catch {
          reject(new Error("Google Drive sent an unexpected reply after the upload"));
        }
      } else reject(new Error(`Google Drive refused the upload (${x.status}) ${x.responseText.slice(0, 160)}`));
    };
    x.onerror = () => reject(new Error("The connection dropped during the upload"));
    x.send(blob);
  });
}

/** Upload one song. Returns its Drive file id. */
export async function uploadSong(blob: Blob, fileName: string, songKey: string, onProgress?: (fraction: number) => void): Promise<string> {
  const existing = await findByKey(songKey);
  if (existing) return existing;
  const folder = await ensureFolder();
  const meta = { name: fileName, parents: [folder], appProperties: { nightjarKey: songKey } };
  const type = blob.type || "application/octet-stream";
  // Resumable upload: one request to start, one to send the file.
  const start = await call(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(blob.size) },
    body: JSON.stringify(meta),
  });
  // Google returns the upload address in "Location"; if the browser can't read that header, the
  // same address can be built from the upload id Google always exposes.
  const uploadId = start.headers.get("X-GUploader-UploadID");
  const location = start.headers.get("Location") ?? (uploadId ? `${UPLOAD}/files?uploadType=resumable&fields=id&upload_id=${encodeURIComponent(uploadId)}` : null);
  if (!location) throw new Error("Google Drive didn’t return an upload address");
  const token = await getDriveToken();
  if (!token) throw new DriveAuthError("Google Drive isn't connected");
  return putFile(location, blob, type, token, onProgress);
}

export async function downloadSong(fileId: string): Promise<Blob> {
  const res = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.blob();
}
