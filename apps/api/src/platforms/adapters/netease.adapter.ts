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

interface NeteaseSong {
  id?: number;
  name?: string;
  ar?: { name?: string }[];
  artists?: { name?: string }[];
  al?: { name?: string; picUrl?: string };
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

  async fetchPlaylist(ref: ParsedRef): Promise<RemotePlaylist> {
    const cookie = process.env.NETEASE_COOKIE?.trim();
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
    const warning =
      declared > songs.length
        ? `平台只返回了前 ${songs.length} 首（共 ${declared} 首）。配置 NETEASE_COOKIE 后可读取完整歌单。`
        : undefined;

    return {
      name: detail.playlist.name ?? '未命名歌单',
      warning,
      description: detail.playlist.description ?? null,
      coverUrl: detail.playlist.coverImgUrl ?? null,
      creator: detail.playlist.creator?.nickname ?? null,
      tracks: songs.map((song): RemoteTrack => {
        const artists = song.ar ?? song.artists ?? [];
        return {
          title: song.name ?? '未知曲目',
          artist: artists.map((a) => a.name).filter(Boolean).join(' / '),
          album: song.al?.name ?? song.album?.name ?? null,
          durationMs: song.dt ?? song.duration ?? null,
          coverUrl: song.al?.picUrl ?? song.album?.picUrl ?? null,
          sourceUrl: song.id ? `https://music.163.com/#/song?id=${song.id}` : null,
          sourceId: song.id ? String(song.id) : null,
        };
      }),
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const response = await fetchJson<NeteaseSearch>(
      `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&limit=${limit}`,
      { headers: { referer: 'https://music.163.com/' } },
    );
    const songs = response.result?.songs ?? [];
    return songs.map((song) => {
      const artists = song.ar ?? song.artists ?? [];
      return {
        title: song.name ?? '',
        artist: artists.map((a) => a.name).filter(Boolean).join(' / '),
        album: song.al?.name ?? song.album?.name ?? null,
        durationMs: song.dt ?? song.duration ?? null,
        coverUrl: song.al?.picUrl ?? song.album?.picUrl ?? null,
        sourceUrl: song.id ? `https://music.163.com/#/song?id=${song.id}` : null,
        sourceId: song.id ? String(song.id) : null,
      };
    });
  }

  searchUrl(query: string): string {
    return `https://music.163.com/#/search/m/?s=${encodeURIComponent(query)}&type=1`;
  }
}
