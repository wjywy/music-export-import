export type Platform = 'netease' | 'qq' | 'kugou' | 'kuwo' | 'apple';
export type Visibility = 'private' | 'unlisted' | 'public';
export type SharePermission = 'view' | 'clone';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  user: User;
}

export interface PlatformInfo {
  platform: Platform;
  name: string;
  short: string;
  monogram: string;
  read: boolean;
  search: boolean;
  write: boolean;
  auth: 'none' | 'cookie' | 'token';
  note: string;
  credential: { envVar: string; configured: boolean; required: boolean };
}

export interface PlaylistSummary {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  sourcePlatform: Platform | null;
  sourceUrl: string | null;
  visibility: Visibility;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrackMatch {
  platform: Platform;
  status: 'matched' | 'missing';
  remoteTitle: string | null;
  remoteArtist: string | null;
  remoteAlbum: string | null;
  remoteUrl: string | null;
  remoteId: string | null;
  source: 'auto' | 'manual' | 'alias';
  score: number;
}

export interface Track {
  id: string;
  position: number;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  coverUrl: string | null;
  sourcePlatform: Platform | null;
  sourceUrl: string | null;
  matches: TrackMatch[];
}

export interface PlaylistDetail {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  sourcePlatform: Platform | null;
  sourceUrl: string | null;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  matches: Partial<Record<Platform, number>>;
  items: Track[];
}

export interface Stats {
  playlistCount: number;
  trackCount: number;
  matchCount: number;
}

export interface Share {
  id: string;
  token: string;
  playlistId: string;
  playlistTitle: string;
  permission: SharePermission;
  expiresAt: string | null;
  viewCount: number;
  cloneCount: number;
  createdAt: string;
}

export interface PublicPlaylist {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  sourcePlatform: Platform | null;
  sourceUrl: string | null;
  visibility: Visibility;
  createdAt: string;
  itemCount: number;
  items: Track[];
}

export interface PublicShare {
  token: string;
  permission: SharePermission;
  expiresAt: string | null;
  viewCount: number;
  cloneCount: number;
  createdAt: string;
  ownerName: string;
  playlist: PublicPlaylist;
}

export interface ImportJob {
  id: string;
  url: string;
  platform: Platform | null;
  platformName: string | null;
  targetPlatform: Platform | null;
  targetPlatformName: string | null;
  status: 'queued' | 'fetching' | 'saving' | 'matching' | 'succeeded' | 'failed';
  progress: number;
  total: number;
  matched: number;
  playlistId: string | null;
  kind: 'single' | 'batch';
  urls: string[] | null;
  duplicateCount: number;
  resultTitle: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRow {
  itemId: string;
  title: string;
  artist: string;
  status: 'ready' | 'search';
  remoteTitle: string | null;
  remoteArtist: string | null;
  url: string | null;
  score: number;
}

export interface Delivery {
  platform: Platform;
  platformName: string;
  total: number;
  ready: number;
  rows: DeliveryRow[];
}

export interface SearchHit {
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  coverUrl: string | null;
  sourceUrl: string | null;
  sourceId: string | null;
}

export interface TrackAlias {
  id: string;
  platform: Platform;
  titleKey: string;
  artistKey: string;
  remoteId: string | null;
  remoteTitle: string;
  remoteArtist: string;
  remoteUrl: string | null;
  score: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppleStatus {
  configured: boolean;
  authorized: boolean;
  storefront: string;
  developerToken?: string;
  connectedAt?: string | null;
  note?: string;
}

export interface ApplePushResult {
  libraryPlaylistId: string;
  name: string;
  added: number;
  skipped: number;
  libraryUrl: string;
}

export interface MergeResult {
  playlist: PlaylistSummary;
  total: number;
  duplicatesRemoved: number;
}

export interface DedupeResult {
  removed: number;
  itemCount: number;
  detail: PlaylistDetail;
}

export interface KuwoSessionStatus {
  source: 'env' | 'auto' | 'none';
  cookieNames: string[];
  refreshedAt: string | null;
  autoRefreshSeconds: number;
}
