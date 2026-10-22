import { normalize } from '../platforms/matching.service';

export interface TrackLike {
  title: string;
  artist?: string | null;
}

export function trackKey(track: TrackLike): string {
  return `${normalize(track.title)}|${normalize(track.artist ?? '')}`;
}

export function dedupeTracks<T extends TrackLike>(tracks: T[]): { tracks: T[]; removed: number } {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const track of tracks) {
    const key = trackKey(track);
    if (key === '|') {
      kept.push(track);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(track);
  }
  return { tracks: kept, removed: tracks.length - kept.length };
}
