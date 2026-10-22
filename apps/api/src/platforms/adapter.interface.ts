import { Platform, PlatformMeta } from '../common/platforms';

export interface ParsedRef {
  platform: Platform;
  kind: 'playlist' | 'album' | 'track';
  id: string;
  url: string;
  storefront?: string;
}

export interface RemoteTrack {
  title: string;
  artist: string;
  album?: string | null;
  durationMs?: number | null;
  coverUrl?: string | null;
  sourceUrl?: string | null;
  sourceId?: string | null;
  isrc?: string | null;
}

export interface RemotePlaylist {
  name: string;
  /** Set when the platform returned a partial playlist (e.g. anonymous NetEase). */
  warning?: string;
  description?: string | null;
  coverUrl?: string | null;
  creator?: string | null;
  tracks: RemoteTrack[];
}

export interface SearchHit extends RemoteTrack {
  externalScore?: number;
}

export interface FetchPlaylistOptions {
  /** Per-user platform session cookie, used when available. */
  cookie?: string;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly meta: PlatformMeta;
  parse(url: string): ParsedRef | null;
  fetchPlaylist(ref: ParsedRef, options?: FetchPlaylistOptions): Promise<RemotePlaylist>;
  search(query: string, limit: number): Promise<SearchHit[]>;
  searchUrl(query: string): string;
}
