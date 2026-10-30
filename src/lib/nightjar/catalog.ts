import type { Album, Track } from "./types";

/**
 * Nightjar starts with an empty, user-owned library.
 * Keep these exports for existing store/view imports; demo albums and audio
 * are intentionally not bundled into the product.
 */
export const ALBUMS: Record<string, never> = {};
export const CATALOG_TRACKS: Track[] = [];
export const CATALOG_ORDER: string[] = [];

/** Group imported/cloud tracks into albums, ordered alphabetically. */
export function collectAlbums(tracks: Track[]): Album[] {
  const map = new Map<string, Album>();
  for (const track of tracks) {
    const existing = map.get(track.albumId);
    if (!existing) {
      map.set(track.albumId, {
        id: track.albumId,
        title: track.album || "Unknown album",
        artist: track.artist || "Unknown artist",
        artwork: track.artwork,
        glow: track.glow,
        trackIds: [track.id],
      });
    } else {
      existing.trackIds.push(track.id);
      if (!existing.artwork && track.artwork) existing.artwork = track.artwork;
    }
  }
  const byId = new Map(tracks.map((track) => [track.id, track] as const));
  for (const album of map.values()) {
    album.trackIds.sort((a, b) => (byId.get(a)?.trackNumber ?? 0) - (byId.get(b)?.trackNumber ?? 0));
  }
  return [...map.values()].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
    a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }),
  );
}
