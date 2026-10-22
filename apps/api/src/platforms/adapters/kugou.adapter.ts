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

interface KugouSong {
  filename?: string;
  songname?: string;
  singername?: string;
  album_name?: string;
  albumname?: string;
  duration?: number;
  hash?: string;
}

interface KugouSongs {
  status?: number;
  errcode?: number;
  data?: { info?: KugouSong[]; total?: number };
}

interface KugouSearch {
  status?: number;
  data?: { info?: KugouSong[] };
}

@Injectable()
export class KugouAdapter implements PlatformAdapter {
  readonly platform = 'kugou' as const;
  readonly meta = PLATFORM_META.kugou;

  parse(url: string): ParsedRef | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!/(^|\.)kugou\.com$/i.test(parsed.hostname)) return null;
    const id =
      parsed.searchParams.get('specialid') ??
      parsed.pathname.match(/\/special\/single\/(\d+)/)?.[1] ??
      parsed.pathname.match(/\/plist\/list\/(\d+)/)?.[1] ??
      parsed.searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) return null;
    return {
      platform: this.platform,
      kind: 'playlist',
      id,
      url: `https://www.kugou.com/yy/special/single/${id}.html`,
    };
  }

  async fetchPlaylist(ref: ParsedRef): Promise<RemotePlaylist> {
    const songsUrl = `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${ref.id}&page=1&pagesize=1000&version=9108`;
    const pageUrl = `https://www.kugou.com/yy/special/single/${ref.id}.html`;

    const [songs, page] = await Promise.all([
      fetchJson<KugouSongs>(songsUrl, { headers: { referer: 'http://m.kugou.com/' } }),
      fetchText(pageUrl, {
        headers: { referer: 'https://www.kugou.com/' },
        timeoutMs: 9000,
      }).catch(() => ''),
    ]);

    const list = songs.data?.info ?? [];
    if (!list.length) {
      throw new PlatformError(
        'NOT_FOUND',
        '没有找到这个酷狗歌单，或歌单里没有可读取的曲目。',
      );
    }

    const title = page.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
    const name = this.decode(title.split('_')[0]?.trim() || '未命名歌单');
    const description =
      page.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? null;
    const coverPath = page.match(/pic\\?\/softhead\\?\/\{size\}\\?\/([^"'\\]+)/)?.[1];
    const coverUrl = coverPath
      ? `https://imge.kugou.com/softhead/400/${coverPath.replace(/\\\//g, '/')}`
      : null;

    return {
      name,
      description: description ? this.decode(description) : null,
      coverUrl,
      creator: null,
      tracks: list.map((song) => this.toTrack(song)),
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const response = await fetchJson<KugouSearch>(
      `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(query)}&page=1&pagesize=${limit}&showtype=1`,
      { headers: { referer: 'http://m.kugou.com/' } },
    );
    return (response.data?.info ?? []).map((song) => this.toTrack(song));
  }

  searchUrl(query: string): string {
    return `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=${encodeURIComponent(query)}`;
  }

  private toTrack(song: KugouSong): RemoteTrack {
    const filename = song.filename ?? '';
    const split = filename.split(' - ');
    const title = song.songname ?? (split.length > 1 ? split.slice(1).join(' - ') : filename);
    const artist = song.singername ?? (split.length > 1 ? split[0] : '');
    return {
      title: title || '未知曲目',
      artist,
      album: song.album_name ?? song.albumname ?? null,
      durationMs: song.duration ? song.duration * 1000 : null,
      sourceUrl: song.hash ? `https://www.kugou.com/song/#hash=${song.hash}` : null,
      sourceId: song.hash ?? null,
    };
  }

  private decode(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
