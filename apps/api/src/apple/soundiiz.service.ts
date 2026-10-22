import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PlaylistsService } from '../playlists/playlists.service';
import {
  SoundiizHttpClient,
  SoundiizHttpResponse,
} from './soundiiz-http.client';

const CHUNK_SIZE = 200;
const MAX_TRACKS = 2_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const CACHE_TTL_MS = 23 * 60 * 60 * 1_000;

export interface SoundiizTrack {
  title: string;
  artist: string;
}

export interface SoundiizChunk {
  index: number;
  from: number;
  to: number;
  items: SoundiizTrack[];
}

export interface SoundiizLink {
  index: number;
  from: number;
  to: number;
  trackCount: number;
  url: string;
  expiresAt: number;
}

export interface SoundiizResult {
  total: number;
  chunkSize: number;
  links: SoundiizLink[];
  note: string;
}

interface SoundiizResponse {
  status?: string;
  message?: string;
  nbTracks?: number;
  shareUrl?: string;
  expiresAt?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildSoundiizChunks(
  items: SoundiizTrack[],
  size = CHUNK_SIZE,
): SoundiizChunk[] {
  const chunks: SoundiizChunk[] = [];
  for (let start = 0; start < items.length; start += size) {
    const end = Math.min(start + size, items.length);
    chunks.push({
      index: chunks.length + 1,
      from: start + 1,
      to: end,
      items: items.slice(start, end),
    });
  }
  return chunks;
}

@Injectable()
export class SoundiizService {
  private readonly recentRequests: number[] = [];
  private readonly cache = new Map<
    string,
    { createdAt: number; result: SoundiizResult }
  >();

  constructor(
    private readonly playlists: PlaylistsService,
    private readonly http: SoundiizHttpClient,
  ) {}

  async createLinks(userId: string, playlistId: string): Promise<SoundiizResult> {
    const detail = await this.playlists.getDetail(playlistId, userId);
    if (detail.items.length === 0) {
      throw new BadRequestException('歌单里还没有曲目。');
    }
    if (detail.items.length > MAX_TRACKS) {
      throw new BadRequestException(
        `Soundiiz 一键导入目前最多支持 ${MAX_TRACKS} 首，请先拆分歌单，或改用 TuneMyMusic 下载文件。`,
      );
    }

    const cacheKey = `${userId}:${playlistId}:${detail.itemCount}:${new Date(
      detail.updatedAt,
    ).getTime()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return cached.result;
    }

    const chunks = buildSoundiizChunks(
      detail.items.map((item) => ({
        title: item.title,
        artist: item.artist,
      })),
    );
    const links: SoundiizLink[] = [];

    for (const chunk of chunks) {
      await this.waitForSlot();
      const response = await this.postToSoundiiz({
        title:
          chunks.length > 1
            ? `${detail.title}（第 ${chunk.index} / ${chunks.length} 段）`
            : detail.title,
        sourceName: '渡口',
        destination: 'applemusicapp',
        tracklist: chunk.items.map((item) => ({
          title: item.title,
          ...(item.artist ? { artists: item.artist } : {}),
        })),
      });

      if (response.status !== 'success' || !response.shareUrl) {
        throw new BadGatewayException(
          `Soundiiz 导入链接生成失败：${response.message ?? '未知错误'}`,
        );
      }

      links.push({
        index: chunk.index,
        from: chunk.from,
        to: chunk.to,
        trackCount: chunk.items.length,
        url: response.shareUrl,
        expiresAt: response.expiresAt ?? Math.floor(Date.now() / 1_000) + 86_400,
      });
    }

    const result: SoundiizResult = {
      total: detail.items.length,
      chunkSize: CHUNK_SIZE,
      links,
      note:
        links.length > 1
          ? `Soundiiz 免费版一次最多导入 ${CHUNK_SIZE} 首，已按段生成 ${links.length} 个链接；请逐段打开完成导入。`
          : '导入链接 24 小时内有效。',
    };
    this.cache.set(cacheKey, { createdAt: Date.now(), result });
    return result;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const recent = this.recentRequests.filter(
        (time) => now - time < RATE_WINDOW_MS,
      );
      this.recentRequests.length = 0;
      this.recentRequests.push(...recent);
      if (recent.length < RATE_LIMIT) {
        this.recentRequests.push(now);
        return;
      }
      await delay(RATE_WINDOW_MS - (now - recent[0]) + 100);
    }
  }

  private async postToSoundiiz(
    payload: Record<string, unknown>,
  ): Promise<SoundiizResponse> {
    let response = await this.http.post(payload);
    if (response.status === 429) {
      const retryAfter = this.headerNumber(response, 'retry-after') ?? 60;
      await delay(Math.max(1, retryAfter) * 1_000);
      response = await this.http.post(payload);
    }
    if (response.status === 429) {
      throw new BadGatewayException(
        'Soundiiz 生成导入链接被限流，请稍后再试，或改用 TuneMyMusic 下载文件。',
      );
    }
    if (response.status < 200 || response.status >= 300) {
      const parsed = this.parseBody(response);
      throw new BadGatewayException(
        `Soundiiz 返回 ${response.status}：${parsed?.message ?? '请稍后重试。'}`,
      );
    }
    const body = this.parseBody(response);
    if (!body) {
      throw new BadGatewayException('Soundiiz 返回内容无法解析。');
    }
    return body;
  }

  private parseBody(response: SoundiizHttpResponse): SoundiizResponse | null {
    try {
      return JSON.parse(response.body) as SoundiizResponse;
    } catch {
      return null;
    }
  }

  private headerNumber(
    response: SoundiizHttpResponse,
    name: string,
  ): number | null {
    const raw = response.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
