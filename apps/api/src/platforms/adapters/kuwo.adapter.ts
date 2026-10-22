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

interface KuwoSong {
  name?: string;
  artist?: string;
  album?: string;
  duration?: number | string;
  rid?: number | string;
  pic?: string;
}

interface KuwoPlaylistResponse {
  code?: number;
  message?: string;
  data?: {
    name?: string;
    pic?: string;
    nickname?: string;
    info?: string;
    musicList?: KuwoSong[];
  };
}

interface KuwoSearchResponse {
  code?: number;
  data?: { list?: KuwoSong[] };
}

@Injectable()
export class KuwoAdapter implements PlatformAdapter {
  readonly platform = 'kuwo' as const;
  readonly meta = PLATFORM_META.kuwo;

  private headers(): Record<string, string> {
    const cookie = process.env.KUWO_COOKIE?.trim() ?? '';
    const token = cookie.match(/kw_token=([^;]+)/)?.[1];
    return {
      referer: 'https://www.kuwo.cn/',
      ...(cookie ? { cookie } : {}),
      ...(token ? { csrf: token } : {}),
    };
  }

  parse(url: string): ParsedRef | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)kuwo\.cn$/i.test(parsed.hostname)) return null;
    const id =
      parsed.searchParams.get('pid') ??
      parsed.searchParams.get('id') ??
      parsed.pathname.match(/\/playlist_detail\/(\d+)/)?.[1] ??
      parsed.pathname.match(/\/playlist\/(\d+)/)?.[1];
    if (!id || !/^\d+$/.test(id)) return null;
    return {
      platform: this.platform,
      kind: 'playlist',
      id,
      url: `https://www.kuwo.cn/playlist_detail/${id}`,
    };
  }

  async fetchPlaylist(ref: ParsedRef): Promise<RemotePlaylist> {
    let response: KuwoPlaylistResponse;
    try {
      response = await fetchJson<KuwoPlaylistResponse>(
        `https://www.kuwo.cn/api/www/playlist/playListInfo?pid=${ref.id}&page=1&pageSize=1000&httpsStatus=1`,
        { headers: this.headers() },
      );
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      throw new PlatformError(
        'AUTH_REQUIRED',
        '酷我接口校验登录状态，请在服务端配置 KUWO_COOKIE（含 kw_token）后重试。',
      );
    }
    const data = response.data;
    if (response.code !== 200 || !data?.musicList?.length) {
      throw new PlatformError(
        'AUTH_REQUIRED',
        '酷我歌单读取失败：该接口需要浏览器 Cookie（KUWO_COOKIE）才能访问。',
      );
    }
    return {
      name: data.name ?? '未命名歌单',
      description: data.info ?? null,
      coverUrl: data.pic ?? null,
      creator: data.nickname ?? null,
      tracks: data.musicList.map((song) => this.toTrack(song)),
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const response = await fetchJson<KuwoSearchResponse>(
      `https://www.kuwo.cn/api/www/search/searchMusicBykeyWord?key=${encodeURIComponent(query)}&pn=1&rn=${limit}&httpsStatus=1`,
      { headers: this.headers() },
    );
    if (response.code !== 200) {
      throw new PlatformError(
        'AUTH_REQUIRED',
        '酷我搜索接口需要登录 Cookie（KUWO_COOKIE）。',
      );
    }
    return (response.data?.list ?? []).map((song) => this.toTrack(song));
  }

  searchUrl(query: string): string {
    return `https://www.kuwo.cn/search/list?key=${encodeURIComponent(query)}`;
  }

  private toTrack(song: KuwoSong): RemoteTrack {
    const seconds = Number(song.duration);
    return {
      title: song.name ?? '未知曲目',
      artist: song.artist ?? '',
      album: song.album ?? null,
      durationMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
      coverUrl: song.pic ?? null,
      sourceUrl: song.rid ? `https://www.kuwo.cn/play_detail/${song.rid}` : null,
      sourceId: song.rid ? String(song.rid) : null,
    };
  }
}
