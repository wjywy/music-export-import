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

interface QQSong {
  title?: string;
  name?: string;
  songname?: string;
  mid?: string;
  songmid?: string;
  album?: { name?: string; title?: string };
  albumname?: string;
  interval?: number;
  singer?: { name?: string }[];
}

interface QQMusicuPlaylist {
  code?: number;
  req_0?: {
    code?: number;
    data?: {
      code?: number;
      dirinfo?: {
        title?: string;
        picurl?: string;
        desc?: string;
        songnum?: number;
        nickname?: string;
      };
      songlist?: QQSong[];
    };
  };
}

interface QQSearchResponse {
  code?: number;
  data?: { song?: { list?: QQSong[] } };
}

const COMM = {
  g_tk: 5381,
  uin: 0,
  format: 'json',
  ct: 6,
  cv: 80600,
  platform: 'wk_v17',
};

@Injectable()
export class QQAdapter implements PlatformAdapter {
  readonly platform = 'qq' as const;
  readonly meta = PLATFORM_META.qq;

  private headers(): Record<string, string> {
    const cookie = process.env.QQ_COOKIE?.trim();
    return {
      referer: 'https://y.qq.com/',
      ...(cookie ? { cookie } : {}),
    };
  }

  parse(url: string): ParsedRef | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)qq\.com$/i.test(parsed.hostname)) return null;
    const id =
      parsed.searchParams.get('id') ??
      parsed.searchParams.get('disstid') ??
      parsed.pathname.match(/\/playlist\/(\d+)/)?.[1] ??
      parsed.pathname.match(/\/taoge\/(\d+)/)?.[1];
    if (!id || !/^\d+$/.test(id)) return null;
    return {
      platform: this.platform,
      kind: 'playlist',
      id,
      url: `https://y.qq.com/n/ryqq/playlist/${id}`,
    };
  }

  async fetchPlaylist(ref: ParsedRef): Promise<RemotePlaylist> {
    const response = await fetchJson<QQMusicuPlaylist>(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          req_0: {
            module: 'music.srfDissInfo.aiDissInfo',
            method: 'uniform_get_Dissinfo',
            param: {
              disstid: Number(ref.id),
              enc_host_uin: '',
              tag: 1,
              userinfo: 1,
              song_begin: 0,
              song_num: 1000,
            },
          },
          comm: COMM,
        }),
      },
    );
    const data = response.req_0?.data;
    if (!data?.dirinfo || data.code !== 0) {
      throw new PlatformError(
        'NOT_FOUND',
        '没有找到这个 QQ 音乐歌单，可能已删除、设为私密，或需要登录。',
      );
    }
    return {
      name: data.dirinfo.title ?? '未命名歌单',
      description: data.dirinfo.desc ?? null,
      coverUrl: data.dirinfo.picurl ?? null,
      creator: data.dirinfo.nickname ?? null,
      tracks: (data.songlist ?? []).map((song) => this.toTrack(song)),
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const response = await fetchJson<QQSearchResponse>(
      `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=${encodeURIComponent(query)}&format=json&n=${limit}&p=1&remoteplace=txt.yqq.song&t=0&aggr=1&cr=1&catZhida=1&lossless=0&flag_qc=0&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
      { headers: this.headers() },
    );
    return (response.data?.song?.list ?? []).map((song) => this.toTrack(song));
  }

  searchUrl(query: string): string {
    return `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(query)}&t=song&remoteplace=txt.yqq.top`;
  }

  private toTrack(song: QQSong): RemoteTrack {
    const mid = song.mid ?? song.songmid ?? null;
    return {
      title: song.title ?? song.name ?? song.songname ?? '未知曲目',
      artist: (song.singer ?? []).map((s) => s.name).filter(Boolean).join(' / '),
      album: song.album?.name ?? song.album?.title ?? song.albumname ?? null,
      durationMs: song.interval ? song.interval * 1000 : null,
      sourceUrl: mid ? `https://y.qq.com/n/ryqq/songDetail/${mid}` : null,
      sourceId: mid,
    };
  }
}
