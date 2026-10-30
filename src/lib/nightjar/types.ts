/** What the file actually is, as read from its header. Nothing here is guessed from the extension alone. */
export type AudioSpec = {
  codec: string;
  container: string;
  bits: number | null;
  sampleRate: number | null;
  /** kbps. For compressed lossless files this is the average over the file. */
  bitrate: number | null;
  channels: number | null;
  duration: number | null;
  lossless: boolean;
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  trackNumber: number;
  duration: number;
  /** URL for catalog tracks. Imported tracks are read from this browser's storage instead. */
  src: string | null;
  artwork: string | null;
  glow: string;
  format: AudioSpec;
  bytes: number | null;
  addedAt: number;
  fileName: string | null;
  liner: string | null;
  /** catalog = ships with the app, local = file in this browser, cloud = in your account but not downloaded here. */
  storage: "catalog" | "local" | "cloud";
  hasEmbeddedArt: boolean;
  playback: "ready" | "unsupported";
  playbackNote: string;
  fingerprint: string | null;
  year?: number;
  /** Same value for the same file on every device (hash of its bytes). Used for sync. */
  songKey?: string | null;
  /** Google Drive file id when the song is backed up. */
  driveId?: string | null;
};

export type Album = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  artwork: string | null;
  glow: string;
  blurb?: string;
  trackIds: string[];
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  /** Last change, used to decide which device wins when syncing. */
  updatedAt?: number;
};

export type RepeatMode = "off" | "all" | "one";

export type View =
  | { name: "listen" }
  | { name: "albums" }
  | { name: "album"; id: string }
  | { name: "artists" }
  | { name: "artist"; name2: string }
  | { name: "songs" }
  | { name: "playlists" }
  | { name: "playlist"; id: string }
  | { name: "queue" }
  | { name: "settings" }
  | { name: "more" };
