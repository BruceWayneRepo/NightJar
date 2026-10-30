// Identify the same song across devices.

const CHUNK = 1 << 20; // 1 MB

/** A key taken from the file's own bytes (size + first and last 1 MB), so it's identical on every device. */
export async function songKeyFor(blob: Blob): Promise<string> {
  const parts = blob.size <= CHUNK * 2 ? [blob] : [blob.slice(0, CHUNK), blob.slice(blob.size - CHUNK)];
  const buf = await new Blob([`${blob.size}:`, ...parts]).arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return (
    "s" +
    Array.from(new Uint8Array(hash))
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** Same song, different file (e.g. FLAC on one phone, MP3 on the other): same title, artist and length within 2 s. */
export function sameSong(a: { title: string; artist: string; duration: number }, b: { title: string; artist: string; duration: number }) {
  return norm(a.title) === norm(b.title) && norm(a.artist) === norm(b.artist) && Math.abs((a.duration || 0) - (b.duration || 0)) <= 2;
}

/** Small JPEG of the cover (fits inside a sync record). */
export async function coverThumb(blob: Blob, size = 256): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

export async function dataUrlToBlob(url: string) {
  return (await fetch(url)).blob();
}
