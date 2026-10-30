import type { AudioSpec } from "./types";

/**
 * Reads format details and tags straight from the file's bytes.
 * Supports WAV (fmt chunk + LIST/INFO), FLAC (STREAMINFO, Vorbis comments, PICTURE),
 * MP3 (ID3v2 text + cover, MPEG frame header) and AIFF. Other types fall back to the
 * file name and what the browser reports, and say so.
 */

export type FileMeta = {
  title: string | null;
  artist: string | null;
  album: string | null;
  trackNumber: number | null;
  year: number | null;
  picture: Blob | null;
  spec: AudioSpec;
};

const HEAD_BYTES = 4 * 1024 * 1024; // tags and headers live at the start

function blank(codec: string, container: string, lossless: boolean): AudioSpec {
  return { codec, container, bits: null, sampleRate: null, bitrate: null, channels: null, duration: null, lossless };
}

function ascii(view: DataView, offset: number, length: number) {
  let s = "";
  for (let i = 0; i < length && offset + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function decodeText(bytes: Uint8Array, encoding: string) {
  try {
    return new TextDecoder(encoding).decode(bytes).replace(/\0+$/g, "").trim();
  } catch {
    return "";
  }
}

function parseTrackNo(value: string | null | undefined) {
  if (!value) return null;
  const n = parseInt(value.split("/")[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseYear(value: string | null | undefined) {
  if (!value) return null;
  const m = value.match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

/* ---------------- WAV ---------------- */
function readWav(view: DataView, fileSize: number): Partial<FileMeta> & { spec: AudioSpec } {
  const spec = blank("WAV", "WAV", true);
  const tags: Record<string, string> = {};
  let pos = 12;
  let dataSize = 0;
  while (pos + 8 <= view.byteLength) {
    const id = ascii(view, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      const format = view.getUint16(body, true);
      spec.channels = view.getUint16(body + 2, true);
      spec.sampleRate = view.getUint32(body + 4, true);
      spec.bits = view.getUint16(body + 14, true);
      if (format === 3) spec.codec = "WAV (float)";
      if (format !== 1 && format !== 3 && format !== 0xfffe) {
        spec.codec = "WAV (compressed)";
        spec.lossless = false;
      }
    } else if (id === "data") {
      dataSize = size;
      break; // audio follows; tags after it are rare
    } else if (id === "LIST" && ascii(view, body, 4) === "INFO") {
      let p = body + 4;
      while (p + 8 <= body + size && p + 8 <= view.byteLength) {
        const key = ascii(view, p, 4);
        const len = view.getUint32(p + 4, true);
        tags[key] = decodeText(new Uint8Array(view.buffer, view.byteOffset + p + 8, Math.min(len, view.byteLength - p - 8)), "utf-8");
        p += 8 + len + (len % 2);
      }
    }
    pos = body + size + (size % 2);
  }
  if (!dataSize) dataSize = Math.max(0, fileSize - pos);
  if (spec.sampleRate && spec.channels && spec.bits) {
    spec.bitrate = (spec.sampleRate * spec.channels * spec.bits) / 1000;
    spec.duration = dataSize / ((spec.sampleRate * spec.channels * spec.bits) / 8);
  }
  return {
    spec,
    title: tags.INAM || null,
    artist: tags.IART || null,
    album: tags.IPRD || null,
    trackNumber: parseTrackNo(tags.ITRK),
    year: parseYear(tags.ICRD),
  };
}

/* ---------------- AIFF ---------------- */
function readAiff(view: DataView): Partial<FileMeta> & { spec: AudioSpec } {
  const spec = blank("AIFF", "AIFF", true);
  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const id = ascii(view, pos, 4);
    const size = view.getUint32(pos + 4, false);
    if (id === "COMM") {
      spec.channels = view.getUint16(pos + 8, false);
      const frames = view.getUint32(pos + 10, false);
      spec.bits = view.getUint16(pos + 14, false);
      // 80-bit extended float sample rate
      const exp = view.getUint16(pos + 16, false) & 0x7fff;
      const mant = view.getUint32(pos + 18, false);
      spec.sampleRate = Math.round(mant * Math.pow(2, exp - 16383 - 31));
      if (spec.sampleRate) spec.duration = frames / spec.sampleRate;
      if (spec.sampleRate && spec.channels && spec.bits) spec.bitrate = (spec.sampleRate * spec.channels * spec.bits) / 1000;
      break;
    }
    pos += 8 + size + (size % 2);
  }
  return { spec };
}

/* ---------------- FLAC ---------------- */
function readFlac(view: DataView, fileSize: number): Partial<FileMeta> & { spec: AudioSpec } {
  const spec = blank("FLAC", "FLAC", true);
  const out: Partial<FileMeta> & { spec: AudioSpec } = { spec };
  const tags: Record<string, string> = {};
  let pos = 4;
  let last = false;
  while (!last && pos + 4 <= view.byteLength) {
    const header = view.getUint8(pos);
    last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = (view.getUint8(pos + 1) << 16) | (view.getUint8(pos + 2) << 8) | view.getUint8(pos + 3);
    const body = pos + 4;
    if (body + len > view.byteLength) break;
    if (type === 0) {
      const b10 = view.getUint8(body + 10);
      const b11 = view.getUint8(body + 11);
      const b12 = view.getUint8(body + 12);
      const b13 = view.getUint8(body + 13);
      spec.sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
      spec.channels = ((b12 >> 1) & 0x07) + 1;
      spec.bits = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
      const total = (b13 & 0x0f) * 2 ** 32 + view.getUint32(body + 14, false);
      if (spec.sampleRate && total) spec.duration = total / spec.sampleRate;
    } else if (type === 4) {
      let p = body;
      const vendorLen = view.getUint32(p, true);
      p += 4 + vendorLen;
      const count = view.getUint32(p, true);
      p += 4;
      for (let i = 0; i < count && p + 4 <= body + len; i++) {
        const l = view.getUint32(p, true);
        const text = decodeText(new Uint8Array(view.buffer, view.byteOffset + p + 4, l), "utf-8");
        const eq = text.indexOf("=");
        if (eq > 0) tags[text.slice(0, eq).toUpperCase()] = text.slice(eq + 1);
        p += 4 + l;
      }
    } else if (type === 6 && !out.picture) {
      let p = body + 4;
      const mimeLen = view.getUint32(p, false);
      const mime = ascii(view, p + 4, mimeLen);
      p += 4 + mimeLen;
      const descLen = view.getUint32(p, false);
      p += 4 + descLen + 16;
      const dataLen = view.getUint32(p, false);
      p += 4;
      if (p + dataLen <= view.byteLength) {
        out.picture = new Blob([new Uint8Array(view.buffer, view.byteOffset + p, dataLen)], { type: mime || "image/jpeg" });
      }
    }
    pos = body + len;
  }
  if (spec.duration) spec.bitrate = (fileSize * 8) / spec.duration / 1000; // average, compressed
  out.title = tags.TITLE || null;
  out.artist = tags.ARTIST || tags.ALBUMARTIST || null;
  out.album = tags.ALBUM || null;
  out.trackNumber = parseTrackNo(tags.TRACKNUMBER);
  out.year = parseYear(tags.DATE || tags.YEAR);
  return out;
}

/* ---------------- MP3 ---------------- */
const MP3_RATES: Record<number, number[]> = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const MP3_SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function syncsafe(view: DataView, p: number) {
  return ((view.getUint8(p) & 0x7f) << 21) | ((view.getUint8(p + 1) & 0x7f) << 14) | ((view.getUint8(p + 2) & 0x7f) << 7) | (view.getUint8(p + 3) & 0x7f);
}

function id3Text(bytes: Uint8Array) {
  const enc = bytes[0];
  const body = bytes.subarray(1);
  if (enc === 1) return decodeText(body, "utf-16");
  if (enc === 2) return decodeText(body, "utf-16be");
  if (enc === 3) return decodeText(body, "utf-8");
  return decodeText(body, "latin1");
}

function readMp3(view: DataView, fileSize: number): Partial<FileMeta> & { spec: AudioSpec } {
  const spec = blank("MP3", "MP3", false);
  const out: Partial<FileMeta> & { spec: AudioSpec } = { spec };
  let audioStart = 0;
  if (ascii(view, 0, 3) === "ID3") {
    const major = view.getUint8(3);
    const size = syncsafe(view, 6);
    audioStart = 10 + size;
    let p = 10;
    const end = Math.min(10 + size, view.byteLength);
    const frames: Record<string, Uint8Array> = {};
    while (p + 10 <= end) {
      const id = ascii(view, p, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const len = major === 4 ? syncsafe(view, p + 4) : view.getUint32(p + 4, false);
      if (len <= 0 || p + 10 + len > end) break;
      if (!frames[id]) frames[id] = new Uint8Array(view.buffer, view.byteOffset + p + 10, len);
      p += 10 + len;
    }
    const t = (id: string) => (frames[id] ? id3Text(frames[id]) : null);
    out.title = t("TIT2");
    out.artist = t("TPE1") || t("TPE2");
    out.album = t("TALB");
    out.trackNumber = parseTrackNo(t("TRCK"));
    out.year = parseYear(t("TDRC") || t("TYER"));
    const apic = frames.APIC;
    if (apic) {
      const enc = apic[0];
      let i = 1;
      let mime = "";
      while (i < apic.length && apic[i] !== 0) mime += String.fromCharCode(apic[i++]);
      i += 2; // null + picture type
      if (enc === 1 || enc === 2) {
        while (i + 1 < apic.length && !(apic[i] === 0 && apic[i + 1] === 0)) i += 2;
        i += 2;
      } else {
        while (i < apic.length && apic[i] !== 0) i++;
        i += 1;
      }
      out.picture = new Blob([apic.subarray(i)], { type: mime || "image/jpeg" });
    }
  }
  for (let p = audioStart; p + 4 < view.byteLength && p < audioStart + 65536; p++) {
    if (view.getUint8(p) !== 0xff || (view.getUint8(p + 1) & 0xe0) !== 0xe0) continue;
    const b1 = view.getUint8(p + 1);
    const b2 = view.getUint8(p + 2);
    const b3 = view.getUint8(p + 3);
    const version = (b1 >> 3) & 0x03; // 3 = MPEG1
    const layer = (b1 >> 1) & 0x03; // 1 = Layer III
    const rateIdx = (b2 >> 4) & 0x0f;
    const srIdx = (b2 >> 2) & 0x03;
    if (layer !== 1 || version === 1 || srIdx === 3) continue;
    const kbps = MP3_RATES[version === 3 ? 1 : 2][rateIdx];
    const sr = MP3_SR[version]?.[srIdx];
    if (!kbps || !sr) continue;
    spec.bitrate = kbps;
    spec.sampleRate = sr;
    spec.channels = (b3 >> 6) === 3 ? 1 : 2;
    spec.duration = ((fileSize - audioStart) * 8) / (kbps * 1000); // exact for CBR, estimate for VBR
    break;
  }
  return out;
}

function byExtension(name: string): AudioSpec {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "m4a" || ext === "mp4" || ext === "aac") return blank(ext === "aac" ? "AAC" : "AAC or ALAC", "MP4", false);
  if (ext === "ogg" || ext === "oga") return blank("Vorbis", "Ogg", false);
  if (ext === "opus") return blank("Opus", "Ogg", false);
  if (ext === "webm") return blank("Opus or Vorbis", "WebM", false);
  if (ext === "wv") return blank("WavPack", "WavPack", true);
  if (ext === "ape") return blank("Monkey's Audio", "APE", true);
  return blank("Unknown", ext.toUpperCase() || "Unknown", false);
}

export async function readFileMeta(file: File): Promise<FileMeta> {
  const head = await file.slice(0, Math.min(file.size, HEAD_BYTES)).arrayBuffer();
  const view = new DataView(head);
  const magic = ascii(view, 0, 4);
  let parsed: Partial<FileMeta> & { spec: AudioSpec };
  try {
    if (magic === "RIFF" && ascii(view, 8, 4) === "WAVE") parsed = readWav(view, file.size);
    else if (magic === "fLaC") parsed = readFlac(view, file.size);
    else if (magic === "FORM" && (ascii(view, 8, 4) === "AIFF" || ascii(view, 8, 4) === "AIFC")) parsed = readAiff(view);
    else if (magic.startsWith("ID3") || /\.mp3$/i.test(file.name)) parsed = readMp3(view, file.size);
    else parsed = { spec: byExtension(file.name) };
  } catch {
    parsed = { spec: byExtension(file.name) };
  }
  return {
    title: parsed.title ?? null,
    artist: parsed.artist ?? null,
    album: parsed.album ?? null,
    trackNumber: parsed.trackNumber ?? null,
    year: parsed.year ?? null,
    picture: parsed.picture ?? null,
    spec: parsed.spec,
  };
}

/** Ask the browser whether it can actually decode this file, and how long it is. */
export function probePlayback(url: string): Promise<{ ok: boolean; duration: number | null }> {
  return new Promise((resolve) => {
    const el = new Audio();
    el.preload = "metadata";
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
      el.removeAttribute("src");
      el.load();
      resolve({ ok, duration });
    };
    el.onloadedmetadata = () => finish(true);
    el.onerror = () => finish(false);
    window.setTimeout(() => finish(false), 8000);
    el.src = url;
  });
}

/** A warm accent colour from the cover, so imported albums get their own glow. */
export async function glowFromImage(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob, { resizeWidth: 24, resizeHeight: 24 });
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, 24, 24);
    const { data } = ctx.getImageData(0, 0, 24, 24);
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      const sat = max === 0 ? 0 : (max - min) / max;
      const weight = 0.2 + sat * (max / 255); // favour colourful, bright pixels
      r += data[i] * weight;
      g += data[i + 1] * weight;
      b += data[i + 2] * weight;
      w += weight;
    }
    if (!w) return null;
    const boost = (v: number) => Math.min(255, Math.round((v / w) * 1.35 + 18));
    return `#${[r, g, b].map((v) => boost(v).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}
