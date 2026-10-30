import type { Album, AudioSpec, Track } from "./types";

/** Asset paths relative to wherever the app is hosted. */
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

function wav(bits: number, rate: number, channels = 2): AudioSpec {
  const bitrate = (rate * channels * bits) / 1000;
  return {
    codec: "WAV",
    container: "WAV",
    bits,
    sampleRate: rate,
    bitrate,
    channels,
    duration: null,
    lossless: true,
  };
}

type Meta = Omit<Album, "trackIds">;

export const ALBUMS: Record<string, Meta> = {
  "low-light": {
    id: "low-light",
    title: "Low Light",
    artist: "Nightjar Ensemble",
    year: 2024,
    artwork: asset("covers/low-light.jpg"),
    glow: "#c45c26",
    blurb: "Slow bells over a dark pedal. Written for the hour when the room goes quiet.",
  },
  "glass-hours": {
    id: "glass-hours",
    title: "Glass Hours",
    artist: "Mira Sol",
    year: 2023,
    artwork: asset("covers/glass-hours.jpg"),
    glow: "#e0a15a",
    blurb: "A lamp, a lid, four chords. Nothing else was invited.",
  },
  "last-train": {
    id: "last-train",
    title: "After the Last Train",
    artist: "South Line Quartet",
    year: 2025,
    artwork: asset("covers/last-train.jpg"),
    glow: "#d4893a",
    blurb: "Platform light, a short walk, then the cars are gone.",
  },
  "field-notes": {
    id: "field-notes",
    title: "Field Notes",
    artist: "A. Vesper",
    year: 2026,
    artwork: asset("covers/field-notes.jpg"),
    glow: "#8a8f72",
    blurb: "Two studies in open fifths. One is 24-bit / 48 kHz. One is 16-bit / 96 kHz.",
  },
};

const base = {
  storage: "catalog" as const,
  year: undefined as number | undefined,
  hasEmbeddedArt: false,
  playback: "ready" as const,
  playbackNote: "PCM file. The browser decodes it. Bit-perfect output is not claimed.",
  fileName: null,
  fingerprint: null,
  liner: null as string | null,
};

export const CATALOG_TRACKS: Track[] = [
  {
    ...base,
    id: "ember-water",
    title: "Ember Water",
    artist: "Nightjar Ensemble",
    album: "Low Light",
    albumId: "low-light",
    trackNumber: 1,
    duration: 16,
    src: asset("audio/ember-water.wav"),
    artwork: asset("covers/low-light.jpg"),
    glow: "#c45c26",
    format: { ...wav(16, 44100), duration: 16 },
    bytes: null,
    addedAt: 1,
    fileName: "ember-water.wav",
    liner: "Original Nightjar session. 16-bit / 44.1 kHz stereo PCM. Instrumental.",
  },
  {
    ...base,
    id: "roost",
    title: "Roost",
    artist: "Nightjar Ensemble",
    album: "Low Light",
    albumId: "low-light",
    trackNumber: 2,
    duration: 12,
    src: asset("audio/roost.wav"),
    artwork: asset("covers/low-light.jpg"),
    glow: "#c45c26",
    format: { ...wav(16, 44100), duration: 12 },
    bytes: null,
    addedAt: 2,
    fileName: "roost.wav",
    liner: "Nightjar session, rebuilt in 2026 after the original file was lost. Sparse upper register, same room as Ember Water.",
  },
  {
    ...base,
    id: "lamp",
    title: "Lamp on the Lid",
    artist: "Mira Sol",
    album: "Glass Hours",
    albumId: "glass-hours",
    trackNumber: 1,
    duration: 16,
    src: asset("audio/lamp.wav"),
    artwork: asset("covers/glass-hours.jpg"),
    glow: "#e0a15a",
    format: { ...wav(16, 44100), duration: 16 },
    bytes: null,
    addedAt: 3,
    fileName: "lamp.wav",
    liner: "Original Nightjar session. Electric piano figures, no vocal.",
  },
  {
    ...base,
    id: "platform",
    title: "Platform",
    artist: "South Line Quartet",
    album: "After the Last Train",
    albumId: "last-train",
    trackNumber: 1,
    duration: 16,
    src: asset("audio/platform.wav"),
    artwork: asset("covers/last-train.jpg"),
    glow: "#d4893a",
    format: { ...wav(16, 44100), duration: 16 },
    bytes: null,
    addedAt: 4,
    fileName: "platform.wav",
    liner: "Nightjar session, rebuilt in 2026 after the original file was lost. Bass, brushed noise, and four chords.",
  },
  {
    ...base,
    id: "before-names",
    title: "Before Names",
    artist: "A. Vesper",
    album: "Field Notes",
    albumId: "field-notes",
    trackNumber: 1,
    duration: 14,
    src: asset("audio/before-names.wav"),
    artwork: asset("covers/field-notes.jpg"),
    glow: "#8a8f72",
    format: { ...wav(24, 48000), duration: 14 },
    bytes: null,
    addedAt: 5,
    fileName: "before-names.wav",
    liner: "Original Nightjar session stored as 24-bit / 48 kHz PCM. The file’s depth is not the device’s output depth.",
  },
  {
    ...base,
    id: "margin",
    title: "Margin",
    artist: "A. Vesper",
    album: "Field Notes",
    albumId: "field-notes",
    trackNumber: 2,
    duration: 8,
    src: asset("audio/margin.wav"),
    artwork: asset("covers/field-notes.jpg"),
    glow: "#8a8f72",
    format: { ...wav(16, 96000), duration: 8 },
    bytes: null,
    addedAt: 6,
    fileName: "margin.wav",
    liner: "Original Nightjar session stored as 16-bit / 96 kHz PCM. Playback may be resampled to the audio context rate.",
  },
];

export const CATALOG_ORDER = ["low-light", "glass-hours", "last-train", "field-notes"];

/**
 * Group tracks into albums, in catalog order first, then by title.
 * Improved: looks tracks up in a Map instead of searching the whole list for
 * every comparison, so large local libraries (thousands of tracks) stay fast.
 */
export function collectAlbums(tracks: Track[]): Album[] {
  const byId = new Map(tracks.map((t) => [t.id, t] as const));
  const map = new Map<string, Album>();
  for (const track of tracks) {
    const known = ALBUMS[track.albumId];
    const existing = map.get(track.albumId);
    if (!existing) {
      map.set(track.albumId, {
        id: track.albumId,
        title: known?.title ?? track.album,
        artist: known?.artist ?? track.artist,
        year: known?.year,
        artwork: known?.artwork ?? track.artwork,
        glow: known?.glow ?? track.glow,
        blurb: known?.blurb,
        trackIds: [track.id],
      });
    } else {
      existing.trackIds.push(track.id);
    }
  }
  const num = (id: string) => byId.get(id)?.trackNumber ?? 0;
  for (const album of map.values()) {
    album.trackIds.sort((a, b) => num(a) - num(b));
  }
  // Catalog albums keep their set order; everything else sorts by title after them.
  const rank = (id: string) => {
    const i = CATALOG_ORDER.indexOf(id);
    return i === -1 ? CATALOG_ORDER.length : i;
  };
  return [...map.values()].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}
