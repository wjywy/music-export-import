import { Injectable } from '@nestjs/common';
import { PLATFORM_META } from '../../common/platforms';
import { PlatformError } from '../../common/platform-error';
import { fetchJson } from '../http';
import {
  FetchPlaylistOptions,
  ParsedRef,
  PlatformAdapter,
  RemotePlaylist,
  RemoteTrack,
  SearchHit,
} from '../adapter.interface';

interface NeteaseSong {
  id?: number;
  name?: string;
  ar?: { name?: string }[];
  artists?: { name?: string }[];
  al?: { name?: string; picUrl?: string } | string;
  album?: { name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
}

interface NeteaseDetail {
  code?: number;
  playlist?: {
    id?: number;
    name?: string;
    description?: string | null;
    coverImgUrl?: string;
    creator?: { nickname?: string };
    trackCount?: number;
    tracks?: NeteaseSong[];
  };
}

interface NeteaseSongs {
  code?: number;
  songs?: NeteaseSong[];
}

interface NeteaseSearch {
  code?: number;
  result?: { songs?: NeteaseSong[] };
}

interface NeteaseApiModule {
  cloudsearch: (params: {
    keywords: string;
    type: number;
    limit: number;
    cookie?: string;
  }) => Promise<{ status: number; body: NeteaseSearch }>;
  playlist_track_all: (params: {
    id: string;
    limit: number;
    offset: number;
    cookie?: string;
  }) => Promise<{ status: number; body: NeteaseSongs }>;
}

// NeteaseCloudMusicApi is a CommonJS package without TypeScript declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const neteaseApi = require('NeteaseCloudMusicApi') as NeteaseApiModule;

@Injectable()
export class NeteaseAdapter implements PlatformAdapter {
  readonly platform = 'netease' as const;
  readonly meta = PLATFORM_META.netease;

  parse(url: string): ParsedRef | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)music\.163\.com$/i.test(parsed.hostname)) return null;

    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '';
    const hashQuery = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : null;
    const id =
      parsed.searchParams.get('id') ??
      hashQuery?.get('id') ??
      hash.match(/\/playlist\/(\d+)/)?.[1] ??
      parsed.pathname.match(/\/playlist\/(\d+)/)?.[1] ??
      parsed.pathname.match(/\/discover\/toplist/)?.[0];

    if (!id || !/^\d+$/.test(id)) return null;
    return {
      platform: this.platform,
      kind: 'playlist',
      id,
      url: `https://music.163.com/#/playlist?id=${id}`,
    };
  }

  async fetchPlaylist(
    ref: ParsedRef,
    options?: FetchPlaylistOptions,
  ): Promise<RemotePlaylist> {
    const cookie = options?.cookie?.trim() || process.env.NETEASE_COOKIE?.trim();
    const headers: Record<string, string> = {
      referer: 'https://music.163.com/',
      ...(cookie ? { cookie } : {}),
    };
    const detail = await fetchJson<NeteaseDetail>(
      `https://music.163.com/api/v6/playlist/detail?id=${ref.id}&n=1000&s=8`,
      { headers },
    );
    if (!detail.playlist) {
      throw new PlatformError('NOT_FOUND', '没有找到这个网易云歌单，可能已删除或需要登录。');
    }

    let songs = detail.playlist.tracks ?? [];
    try {
      const all = await fetchJson<NeteaseSongs>(
        `https://music.163.com/api/playlist/track/all?id=${ref.id}&limit=1000&offset=0`,
        { headers },
      );
      if (all.code === 200 && all.songs?.length) songs = all.songs;
    } catch {
      // The embedded tracks are still usable when the full-list endpoint is blocked.
    }

    const declared = detail.playlist.trackCount ?? songs.length;
    if (declared > songs.length && cookie) {
      try {
        const all = await neteaseApi.playlist_track_all({
          id: ref.id,
          limit: 1000,
          offset: 0,
          cookie,
        });
        if (all.body?.code === 200 && all.body.songs?.length) {
          songs = all.body.songs;
        }
      } catch {
        // Keep the partial list and warn below.
      }
    }
    const warning =
      declared > songs.length
        ? `平台只返回了前 ${songs.length} 首（共 ${declared} 首）。连接网易云或配置 NETEASE_COOKIE 后可读取完整歌单。`
        : undefined;

    return {
      name: detail.playlist.name ?? '未命名歌单',
      warning,
      description: detail.playlist.description ?? null,
      coverUrl: detail.playlist.coverImgUrl ?? null,
      creator: detail.playlist.creator?.nickname ?? null,
      tracks: songs.map((song): RemoteTrack => {
        const artists = song.ar ?? song.artists ?? [];
        const albumObject = typeof song.al === 'object' ? song.al : null;
        const albumName =
          typeof song.al === 'string'
            ? song.al
            : song.al?.name ?? song.album?.name ?? null;
        return {
          title: song.name ?? '未知曲目',
          artist: artists.map((a) => a.name).filter(Boolean).join(' / '),
          album: albumName,
          durationMs: song.dt ?? song.duration ?? null,
          coverUrl: albumObject?.picUrl ?? song.album?.picUrl ?? null,
          sourceUrl: song.id ? `https://music.163.com/#/song?id=${song.id}` : null,
          sourceId: song.id ? String(song.id) : null,
        };
      }),
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const cookie = process.env.NETEASE_COOKIE?.trim() || undefined;
    const response = await neteaseApi.cloudsearch({
      keywords: query,
      type: 1,
      limit,
      cookie,
    });
    if (response.status !== 200 || response.body?.code === 405) {
      throw new PlatformError(
        'RATE_LIMITED',
        '网易云音乐搜索被限流，请稍后重试。',
      );
    }
    const songs = response.body?.result?.songs ?? [];
    return songs.map((song) => {
      const artists = song.ar ?? song.artists ?? [];
      const albumObject = typeof song.al === 'object' ? song.al : null;
      const albumName =
        typeof song.al === 'string'
          ? song.al
          : song.al?.name ?? song.album?.name ?? null;
      return {
        title: song.name ?? '',
        artist: artists.map((a) => a.name).filter(Boolean).join(' / '),
        album: albumName,
        durationMs: song.dt ?? song.duration ?? null,
        coverUrl: albumObject?.picUrl ?? song.album?.picUrl ?? null,
        sourceUrl: song.id ? `https://music.163.com/#/song?id=${song.id}` : null,
        sourceId: song.id ? String(song.id) : null,
      };
    });
  }

  searchUrl(query: string): string {
    return `https://music.163.com/#/search/m/?s=${encodeURIComponent(query)}&type=1`;
  }
}
