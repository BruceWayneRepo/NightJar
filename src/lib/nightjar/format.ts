import type { AudioSpec, Track } from "./types";

export function formatKhz(hz: number) {
  const k = hz / 1000;
  const rounded = Math.round(k * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatBitrate(kbps: number) {
  return `${Math.round(kbps).toLocaleString("en-US")} kbps`;
}

/** 1536 -> "1.5 KB", 734003200 -> "700 MB". For storage and file sizes. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}:${mm.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
  }
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function specLine(spec: AudioSpec) {
  const head = spec.codec === "Unknown" ? spec.container || "Unknown" : spec.codec;
  const parts = [head];
  if (spec.bits && spec.sampleRate) {
    parts.push(`${spec.bits}-bit / ${formatKhz(spec.sampleRate)} kHz`);
  } else if (spec.sampleRate) {
    parts.push(`${formatKhz(spec.sampleRate)} kHz`);
  }
  if (spec.bitrate && spec.bitrate > 0) parts.push(formatBitrate(spec.bitrate));
  return parts.join(" · ");
}

export function channelLabel(channels: number | null) {
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  if (channels && channels > 2) return `${channels} channels`;
  return "Channels unknown";
}

export function pathSummary(track: Track, contextRate: number | null, eqOn: boolean, crossfade: number) {
  const fileRate = track.format.sampleRate;
  const resample =
    contextRate && fileRate && Math.abs(contextRate - fileRate) > 1
      ? `File is ${formatKhz(fileRate)} kHz; this audio context is ${formatKhz(contextRate)} kHz, so the browser is resampling.`
      : contextRate
        ? `Audio context is ${formatKhz(contextRate)} kHz. Output bit depth is not exposed.`
        : "Audio context opens on the first play.";
  const processing = [
    eqOn ? "Equalizer is in the path." : "Equalizer is bypassed at 0 dB, but the Web Audio graph is still in the path.",
    crossfade > 0 ? `Crossfade ${crossfade.toFixed(1)} s overlaps track changes.` : "No crossfade.",
  ].join(" ");
  return { resample, processing };
}
