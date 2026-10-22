import { Injectable } from '@nestjs/common';
import { PLATFORM_META } from '../../common/platforms';
import { PlatformError } from '../../common/platform-error';
import { fetchJson, fetchText } from '../http';
import { KuwoSessionService } from '../kuwo-session.service';
import {
  ParsedRef,
  PlatformAdapter,
  RemotePlaylist,
  RemoteTrack,
  SearchHit,
} from '../adapter.interface';

interface KuwoSearchSong {
  NAME?: string;
  SONGNAME?: string;
  ARTIST?: string;
  ALBUM?: string;
  DURATION?: string | number;
  MUSICRID?: string;
  DC_TARGETID?: string | number;
  web_albumpic_short?: string;
}

interface KuwoSearchResponse {
  TOTAL?: string;
  abslist?: KuwoSearchSong[];
}

@Injectable()
export class KuwoAdapter implements PlatformAdapter {
  readonly platform = 'kuwo' as const;
  readonly meta = PLATFORM_META.kuwo;

  constructor(private readonly session: KuwoSessionService) {}

  private async headers(accept = 'application/json'): Promise<Record<string, string>> {
    return {
      referer: 'https://www.kuwo.cn/',
      accept,
      ...(await this.session.cookieHeader()),
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
    const html = await fetchText(`https://www.kuwo.cn/playlist_detail/${ref.id}`, {
      headers: await this.headers('text/html,application/xhtml+xml'),
      timeoutMs: 15_000,
    });

    if (!html.includes('playListInfo') || !html.includes('musicList')) {
      throw new PlatformError(
        'NOT_FOUND',
        '没有找到这个酷我歌单，可能已删除、设为私密，或链接有误。',
      );
    }

    const payloadStart = html.indexOf('playListInfo:{');
    const payload = payloadStart >= 0 ? html.slice(payloadStart) : html;
    const title = this.documentTitle(html);
    const creator = this.stringField(payload, 'userName') ?? title.creator;
    const name = title.name || this.stringField(payload, 'name') || '未命名歌单';
    const coverUrl =
      this.stringField(payload, 'img700') ??
      this.stringField(payload, 'img500') ??
      this.stringField(payload, 'img');
    const description = this.description(html) ?? this.stringField(payload, 'tag');

    const array = this.extractArray(payload, 'musicList');
    const objects = array ? this.splitObjects(array) : [];
    const tracks = objects
      .map((object) => this.toTrack(object))
      .filter((track): track is RemoteTrack => Boolean(track));

    if (tracks.length === 0) {
      throw new PlatformError('NOT_FOUND', '这个酷我歌单没有可读取的曲目。');
    }

    return {
      name,
      description: description ?? null,
      coverUrl: coverUrl ?? null,
      creator: creator ?? null,
      tracks,
    };
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const response = await fetchJson<KuwoSearchResponse>(
      `https://www.kuwo.cn/search/searchMusicBykeyWord?vipver=1&client=kt&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1&show_copyright_off=1&pn=0&rn=${limit}&all=${encodeURIComponent(query)}`,
      { headers: await this.headers() },
    );
    return (response.abslist ?? []).map((song) => this.toSearchTrack(song));
  }

  searchUrl(query: string): string {
    return `https://www.kuwo.cn/search/list?key=${encodeURIComponent(query)}`;
  }

  private toSearchTrack(song: KuwoSearchSong): SearchHit {
    const seconds = Number(song.DURATION);
    const rid =
      song.DC_TARGETID ??
      song.MUSICRID?.replace(/^MUSIC_/, '') ??
      null;
    return {
      title: song.SONGNAME ?? song.NAME ?? '未知曲目',
      artist: song.ARTIST ?? '',
      album: song.ALBUM || null,
      durationMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null,
      coverUrl: null,
      sourceUrl: rid ? `https://www.kuwo.cn/play_detail/${rid}` : null,
      sourceId: rid ? String(rid) : null,
    };
  }

  private toTrack(object: string): RemoteTrack | null {
    const name = this.stringField(object, 'name');
    if (!name) return null;
    const artist = this.stringField(object, 'artist') ?? '';
    const seconds = this.numberField(object, 'duration');
    const rid =
      this.numberField(object, 'rid')?.toString() ??
      this.stringField(object, 'musicrid')?.replace(/^MUSIC_/, '') ??
      null;
    return {
      title: name,
      artist,
      album: this.stringField(object, 'album'),
      durationMs: seconds ? seconds * 1000 : null,
      coverUrl: null,
      sourceUrl: rid ? `https://www.kuwo.cn/play_detail/${rid}` : null,
      sourceId: rid,
    };
  }

  private documentTitle(html: string): { name: string; creator: string | null } {
    const raw = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    const title = this.decode(raw);
    const trimmed = title.replace(/_酷我音乐\s*$/, '').trim();
    const parts = trimmed.split('_');
    if (parts.length >= 2) {
      const creator = parts.pop()?.trim() ?? null;
      return { name: parts.join('_').trim() || trimmed, creator };
    }
    return { name: trimmed, creator: null };
  }

  private description(html: string): string | null {
    const match = html.match(
      /<p[^>]*class="intr_txt"[^>]*>([\s\S]*?)<\/p>/i,
    );
    if (!match) return null;
    const text = this.decode(
      match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    return text || null;
  }

  private extractArray(source: string, key: string): string | null {
    const marker = `${key}:[`;
    const start = source.indexOf(marker);
    if (start < 0) return null;
    let index = start + marker.length;
    let depth = 1;
    let quote: string | null = null;
    let escaped = false;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '[') depth += 1;
      if (char === ']') {
        depth -= 1;
        if (depth === 0) return source.slice(start + marker.length, index);
      }
    }
    return null;
  }

  private splitObjects(array: string): string[] {
    const objects: string[] = [];
    let depth = 0;
    let start = -1;
    let quote: string | null = null;
    let escaped = false;
    for (let index = 0; index < array.length; index += 1) {
      const char = array[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{') {
        if (depth === 0) start = index;
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          objects.push(array.slice(start, index + 1));
          start = -1;
        }
      }
    }
    return objects;
  }

  private stringField(source: string, key: string): string | null {
    const match = source.match(
      new RegExp(`(?:^|[,{])\\s*${key}\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`),
    );
    if (!match) return null;
    try {
      return JSON.parse(match[1]) as string;
    } catch {
      return match[1].slice(1, -1);
    }
  }

  private numberField(source: string, key: string): number | null {
    const match = source.match(
      new RegExp(`(?:^|[,{])\\s*${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`),
    );
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  private decode(value: string): string {
    return value
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match, code: string) =>
        String.fromCharCode(parseInt(code, 16)),
      )
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }
}
