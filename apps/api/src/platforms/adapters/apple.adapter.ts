import { Injectable } from '@nestjs/common';
import { PLATFORM_META } from '../../common/platforms';
import { PlatformError } from '../../common/platform-error';
import { fetchJson } from '../http';
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
