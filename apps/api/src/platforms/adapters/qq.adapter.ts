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

interface QQDirInfo {
  title?: string;
  picurl?: string;
  desc?: string;
  songnum?: number;
  nickname?: string;
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
    const pageSize = 1000;
    const songs: QQSong[] = [];
    let dirinfo: QQDirInfo | null = null;
    let total: number | null = null;
    let begin = 0;
    let partialError: unknown = null;

    for (let page = 0; page < 30; page += 1) {
      let response: QQMusicuPlaylist;
      try {
        response = await fetchJson<QQMusicuPlaylist>(
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
                  song_begin: begin,
                  song_num: pageSize,
                },
              },
              comm: COMM,
            }),
          },
        );
      } catch (error) {
        if (page === 0) throw error;
        partialError = error;
        break;
      }

      const data = response.req_0?.data;
      if (!data?.dirinfo || data.code !== 0) {
        if (page === 0) {
          throw new PlatformError(
            'NOT_FOUND',
            '没有找到这个 QQ 音乐歌单，可能已删除、设为私密，或需要登录。',
          );
        }
        break;
      }

      if (page === 0) {
        dirinfo = data.dirinfo;
        total = data.dirinfo.songnum ?? null;
      }

      const pageSongs = data.songlist ?? [];
      songs.push(...pageSongs);
      if (pageSongs.length === 0) break;
      begin += pageSongs.length;
      if (total !== null && songs.length >= total) break;
      if (pageSongs.length < pageSize) break;
    }

    if (!dirinfo) {
      throw new PlatformError(
        'NOT_FOUND',
        '没有找到这个 QQ 音乐歌单，可能已删除、设为私密，或需要登录。',
      );
    }

    const warning =
      total !== null && songs.length < total
        ? `平台只返回了 ${songs.length} / ${total} 首${partialError ? '，后续分页读取失败' : ''}。`
        : undefined;

    return {
      name: dirinfo.title ?? '未命名歌单',
      warning,
      description: dirinfo.desc ?? null,
      coverUrl: dirinfo.picurl ?? null,
      creator: dirinfo.nickname ?? null,
      tracks: songs.map((song) => this.toTrack(song)),
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const response = await fetchJson<QQSearchResponse>(
      `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=${encodeURIComponent(query)}&format=json&n=${limit}&p=1&remoteplace=txt.yqq.song&t=0&aggr=1&cr=1&catZhida=1&lossless=0&flag_qc=0&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
      { headers: this.headers() },
    );
    return (response.data?.song?.list ?? [])
      .map((song) => this.toTrack(song))
      .filter((track) => Boolean(track.sourceId));
  }

  searchUrl(query: string): string {
    return `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(query)}&t=song&remoteplace=txt.yqq.top`;
  }

  private toTrack(song: QQSong): RemoteTrack {
    const mid = song.mid ?? song.songmid ?? null;
    const validMid = mid && mid !== '0' ? mid : null;
    return {
      title: song.title ?? song.name ?? song.songname ?? '未知曲目',
      artist: (song.singer ?? []).map((s) => s.name).filter(Boolean).join(' / '),
      album: song.album?.name ?? song.album?.title ?? song.albumname ?? null,
      durationMs: song.interval ? song.interval * 1000 : null,
      sourceUrl: validMid ? `https://y.qq.com/n/ryqq/songDetail/${validMid}` : null,
      sourceId: validMid,
    };
  }
}
