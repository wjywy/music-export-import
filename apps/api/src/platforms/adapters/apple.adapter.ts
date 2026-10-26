import { Injectable } from '@nestjs/common';
import { PLATFORM_META } from '../../common/platforms';
import { PlatformError } from '../../common/platform-error';
import { fetchJson, fetchText } from '../http';
import {
  ParsedRef,
  PlatformAdapter,
  RemotePlaylist,
  RemoteTrack,
  SearchHit,
} from '../adapter.interface';

interface AppleArtwork {
  url?: string;
}

interface AppleSongAttributes {
  name?: string;
  artistName?: string;
  albumName?: string;
  durationInMillis?: number;
  isrc?: string;
  url?: string;
  artwork?: AppleArtwork;
}

interface AppleTrack {
  id?: string;
  attributes?: AppleSongAttributes;
}

interface ApplePlaylistData {
  id?: string;
  attributes?: {
    name?: string;
    description?: { standard?: string };
    artwork?: AppleArtwork;
    curatorName?: string;
  };
  relationships?: {
    tracks?: {
      data?: AppleTrack[];
      next?: string;
    };
  };
}

interface AppleSingleResponse {
  data?: ApplePlaylistData[];
}

interface AppleSearchResponse {
  results?: { songs?: { data?: { id?: string; attributes?: AppleSongAttributes }[] } };
}

interface AppleSerializedTrack {
  title?: string;
  artistName?: string;
  duration?: number;
  artwork?: { dictionary?: { url?: string } };
  contentDescriptor?: {
    kind?: string;
    identifiers?: { storeAdamID?: string };
    url?: string;
  };
}

interface AppleLdPlaylist {
  name?: string;
  description?: string;
  numTracks?: number;
  author?: { name?: string };
}

@Injectable()
export class AppleAdapter implements PlatformAdapter {
  readonly platform = 'apple' as const;
  readonly meta = PLATFORM_META.apple;

  private token(): string {
    const token = process.env.APPLE_MUSIC_TOKEN?.trim();
    if (!token) {
      throw new PlatformError(
        'AUTH_REQUIRED',
        'Apple Music 需要开发者令牌：请设置 APPLE_MUSIC_TOKEN（MusicKit JWT）后重试。',
      );
    }
    return token;
  }

  private storefront(): string {
    return process.env.APPLE_MUSIC_STOREFRONT?.trim() || 'cn';
  }

  parse(url: string): ParsedRef | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)music\.apple\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(
      /^\/([a-z]{2})\/(playlist|album)\/([^/]+)\/([a-zA-Z0-9._-]+)/,
    );
    if (!match) return null;
    return {
      platform: this.platform,
      kind: match[2] as 'playlist' | 'album',
      id: match[4],
      storefront: match[1],
      url: `https://music.apple.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`,
    };
  }

  async fetchPlaylist(ref: ParsedRef): Promise<RemotePlaylist> {
    const publicPlaylist = await this.fetchPublicPlaylist(ref);
    if (publicPlaylist) return publicPlaylist;
    return this.fetchCatalogPlaylist(ref);
  }

  private async fetchPublicPlaylist(ref: ParsedRef): Promise<RemotePlaylist | null> {
    let html: string;
    try {
      html = await fetchText(ref.url, {
        headers: { referer: 'https://music.apple.com/' },
        timeoutMs: 20_000,
      });
    } catch {
      return null;
    }

    const serialized = html.match(
      /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];
    if (!serialized) return null;

    let root: unknown;
    try {
      root = JSON.parse(serialized);
    } catch {
      return null;
    }

    const found: AppleSerializedTrack[] = [];
    this.collectSerializedTracks(root, found);
    const seen = new Set<string>();
    const tracks: RemoteTrack[] = [];
    for (const item of found) {
      if (!item.title || !item.artistName) continue;
      const sourceId = item.contentDescriptor?.identifiers?.storeAdamID;
      const key = sourceId ?? `${item.title}|${item.artistName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const artworkUrl = item.artwork?.dictionary?.url;
      tracks.push({
        title: item.title,
        artist: item.artistName,
        album: null,
        durationMs: item.duration ?? null,
        coverUrl: artworkUrl
          ? artworkUrl.replace('{w}', '600').replace('{h}', '600')
          : null,
        sourceUrl: item.contentDescriptor?.url ?? null,
        sourceId: sourceId ?? null,
        isrc: null,
      });
    }
    if (tracks.length === 0) return null;

    let metadata: AppleLdPlaylist = {};
    const ld = html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];
    if (ld) {
      try {
        metadata = JSON.parse(ld) as AppleLdPlaylist;
      } catch {
        metadata = {};
      }
    }

    const total = metadata.numTracks ?? tracks.length;
    return {
      name: metadata.name ?? 'Apple Music 歌单',
      description: metadata.description ?? null,
      coverUrl: tracks[0]?.coverUrl ?? null,
      creator: metadata.author?.name ?? null,
      warning:
        total > tracks.length
          ? `Apple Music 公开页面只返回了 ${tracks.length} / ${total} 首。`
          : undefined,
      tracks,
    };
  }

  private collectSerializedTracks(value: unknown, out: AppleSerializedTrack[]): void {
    if (Array.isArray(value)) {
      for (const item of value) this.collectSerializedTracks(item, out);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (
      typeof record.title === 'string' &&
      typeof record.artistName === 'string' &&
      record.contentDescriptor &&
      typeof record.contentDescriptor === 'object'
    ) {
      out.push(record as AppleSerializedTrack);
    }
    for (const child of Object.values(record)) {
      this.collectSerializedTracks(child, out);
    }
  }

  private async fetchCatalogPlaylist(ref: ParsedRef): Promise<RemotePlaylist> {
    const token = this.token();
    const storefront = ref.storefront || this.storefront();
    const plural = ref.kind === 'album' ? 'albums' : 'playlists';
    const response = await fetchJson<AppleSingleResponse>(
      `https://api.music.apple.com/v1/catalog/${storefront}/${plural}/${ref.id}?include=tracks&limit[tracks]=100`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const playlist = response.data?.[0];
    if (!playlist) {
      throw new PlatformError('NOT_FOUND', '没有找到这个 Apple Music 歌单或专辑。');
    }
    const tracks: RemoteTrack[] = [];
    let page = playlist.relationships?.tracks;
    let guard = 0;
    while (page && guard < 20) {
      for (const track of page.data ?? []) {
        const attributes = track.attributes;
        if (!attributes) continue;
        tracks.push({
          title: attributes.name ?? '未知曲目',
          artist: attributes.artistName ?? '',
          album: attributes.albumName ?? null,
          durationMs: attributes.durationInMillis ?? null,
          coverUrl: this.artwork(attributes.artwork),
          sourceUrl: attributes.url ?? null,
          sourceId: track.id ?? null,
          isrc: attributes.isrc ?? null,
        });
      }
      if (!page.next) break;
      page = await fetchJson<typeof page>(`https://api.music.apple.com${page.next}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      guard += 1;
    }
    return {
      name: playlist.attributes?.name ?? '未命名歌单',
      description: playlist.attributes?.description?.standard ?? null,
      coverUrl: this.artwork(playlist.attributes?.artwork),
      creator: playlist.attributes?.curatorName ?? null,
      tracks,
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const token = this.token();
    const storefront = this.storefront();
    const response = await fetchJson<AppleSearchResponse>(
      `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${encodeURIComponent(query)}&types=songs&limit=${limit}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    return (response.results?.songs?.data ?? []).map((song) => ({
      title: song.attributes?.name ?? '',
      artist: song.attributes?.artistName ?? '',
      album: song.attributes?.albumName ?? null,
      durationMs: song.attributes?.durationInMillis ?? null,
      coverUrl: this.artwork(song.attributes?.artwork),
      sourceUrl: song.attributes?.url ?? null,
      sourceId: song.id ?? null,
      isrc: song.attributes?.isrc ?? null,
    }));
  }

  searchUrl(query: string): string {
    return `https://music.apple.com/${this.storefront()}/search?term=${encodeURIComponent(query)}`;
  }

  private artwork(artwork?: AppleArtwork): string | null {
    if (!artwork?.url) return null;
    return artwork.url.replace('{w}', '600').replace('{h}', '600');
  }
}
