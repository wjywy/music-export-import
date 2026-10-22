import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformCredential } from '../common/entities/platform-credential.entity';
import { platformName } from '../common/platforms';
import { CredentialCipher } from '../platforms/credential-cipher.service';
import {
  PlaylistDetail,
  PlaylistsService,
} from '../playlists/playlists.service';
import { AppleTokenService } from './apple-token.service';

const APPLE_API = 'https://api.music.apple.com';
const MAX_TRACKS_PER_REQUEST = 100;
const MAX_PLAYLIST_TRACKS = 500;
const NAME_LIMIT = 180;

export interface AppleStatus {
  configured: boolean;
  authorized: boolean;
  storefront: string;
  developerToken?: string;
  connectedAt?: Date | null;
  note?: string;
}

export interface ApplePushResult {
  platform: 'apple';
  playlistId: string;
  name: string;
  url: string;
  added: number;
  skipped: number;
  failed: number;
  warning?: string | null;
}

interface AppleErrorPayload {
  errors?: { title?: string; detail?: string; status?: string }[];
}

interface AppleTrackPage {
  data?: { id?: string }[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactName(title: string): string {
  const trimmed = title.trim() || '未命名歌单';
  return `${Array.from(trimmed).slice(0, NAME_LIMIT).join('')} · 渡口`;
}

@Injectable()
export class AppleMusicService {
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(PlatformCredential)
    private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher,
    private readonly playlists: PlaylistsService,
    private readonly tokens: AppleTokenService,
  ) {}

  private storefront(): string {
    return process.env.APPLE_MUSIC_STOREFRONT?.trim() || 'cn';
  }

  private developerToken(): string {
    const token = this.tokens.developerToken();
    if (!token) {
      throw new BadRequestException(
        '服务端未配置 Apple Music 开发者令牌，无法授权或写入。',
      );
    }
    return token;
  }

  private headers(musicUserToken?: string): Record<string, string> {
    return {
      authorization: `Bearer ${this.developerToken()}`,
      ...(musicUserToken ? { 'music-user-token': musicUserToken } : {}),
      'content-type': 'application/json',
    };
  }

  async status(userId: string): Promise<AppleStatus> {
    const configured = this.tokens.isConfigured();
    const credential = await this.credentials.findOne({
      where: { userId, platform: 'apple' },
    });
    let authorized = false;
    if (credential) {
      try {
        this.cipher.decrypt(credential.encryptedToken);
        authorized = true;
      } catch {
        authorized = false;
      }
    }
    return {
      configured,
      authorized,
      storefront: credential?.storefront ?? this.storefront(),
      connectedAt: credential?.createdAt ?? null,
      note: configured ? undefined : (this.safeConfiguredNote() ?? undefined),
    };
  }

  async config(userId: string): Promise<AppleStatus> {
    const status = await this.status(userId);
    if (!status.configured) return status;

    try {
      return {
        ...status,
        developerToken: this.tokens.developerToken() ?? undefined,
        note: this.safeConfiguredNote() ?? undefined,
      };
    } catch (error) {
      return {
        ...status,
        developerToken: undefined,
        configured: false,
        note:
          error instanceof Error
            ? error.message
            : 'Apple Music 开发者令牌签发失败。',
      };
    }
  }

  async authorize(
    userId: string,
    musicUserToken: string,
    _storefront?: string,
  ): Promise<AppleStatus> {
    const headers = this.headers(musicUserToken);

    const storefrontResponse = await this.appleFetch(
      `${APPLE_API}/v1/me/storefront`,
      { headers },
      15_000,
      '校验账号区号',
    );
    if (storefrontResponse.status === 401 || storefrontResponse.status === 403) {
      throw new UnauthorizedException(
        'Apple Music 用户令牌无效、已过期，或账号没有 Apple Music 订阅。',
      );
    }
    if (!storefrontResponse.ok) {
      throw new BadGatewayException(
        `Apple Music 校验失败（${storefrontResponse.status}）。`,
      );
    }
    const storefrontPayload = (await storefrontResponse.json()) as {
      data?: { id?: string }[];
    };
    const actualStorefront = storefrontPayload.data?.[0]?.id ?? null;
    if (!actualStorefront) {
      throw new BadGatewayException('Apple Music 没有返回账号区号。');
    }
    const expected = this.storefront();
    if (actualStorefront !== expected) {
      throw new BadRequestException(
        `当前只支持 ${expected} 区 Apple Music，你的账号是 ${actualStorefront} 区。暂时无法写入，请换用 ${expected} 区账号。`,
      );
    }

    const libraryResponse = await this.appleFetch(
      `${APPLE_API}/v1/me/library/playlists?limit=1`,
      { headers },
      15_000,
      '校验资料库权限',
    );
    if (libraryResponse.status === 401 || libraryResponse.status === 403) {
      throw new UnauthorizedException(
        'Apple Music 授权无效，或该 Apple ID 没有有效的 Apple Music 订阅。',
      );
    }
    if (!libraryResponse.ok) {
      throw new BadGatewayException(
        `Apple Music 资料库校验失败（${libraryResponse.status}）。`,
      );
    }

    const credential =
      (await this.credentials.findOne({
        where: { userId, platform: 'apple' },
      })) ?? this.credentials.create({ userId, platform: 'apple' });
    credential.encryptedToken = this.cipher.encrypt(musicUserToken);
    credential.storefront = actualStorefront;
    credential.tokenExpiresAt = null;
    await this.credentials.save(credential);
    return this.status(userId);
  }

  async disconnect(userId: string): Promise<{ ok: true }> {
    await this.credentials.delete({ userId, platform: 'apple' });
    return { ok: true };
  }

  async pushPlaylist(
    userId: string,
    playlistId: string,
  ): Promise<ApplePushResult> {
    const developerToken = this.developerToken();
    const credential = await this.credentials.findOne({
      where: { userId, platform: 'apple' },
    });
    if (!credential) {
      throw new UnauthorizedException('还没有连接 Apple Music，请先授权。');
    }
    if (credential.storefront !== this.storefront()) {
      throw new BadRequestException(
        `Apple Music 授权区号是 ${credential.storefront}，当前服务只支持 ${this.storefront()}，请重新授权。`,
      );
    }
    let musicUserToken: string;
    try {
      musicUserToken = this.cipher.decrypt(credential.encryptedToken);
    } catch {
      throw new UnauthorizedException(
        'Apple Music 登录态已损坏，请重新授权。',
      );
    }
    const lockKey = `${userId}:${playlistId}`;
    if (this.inFlight.has(lockKey)) {
      throw new ConflictException('这张歌单正在写入 Apple Music，请稍候。');
    }
    this.inFlight.add(lockKey);

    try {
      let detail = await this.playlists.getDetail(playlistId, userId);
      if (detail.items.length > MAX_PLAYLIST_TRACKS) {
        throw new BadRequestException(
          `Apple Music 迁移目前最多支持 ${MAX_PLAYLIST_TRACKS} 首，请先拆分歌单。`,
        );
      }

      if (this.appleTrackIds(detail).length === 0) {
        await this.playlists.match(playlistId, userId, 'apple');
        detail = await this.playlists.getDetail(playlistId, userId);
      }

      const trackIds = this.appleTrackIds(detail);
      if (trackIds.length === 0) {
        throw new BadRequestException(
          '还没有匹配到 Apple Music 的曲目。请先匹配，或换一张歌单。',
        );
      }

      const headers = {
        authorization: `Bearer ${developerToken}`,
        'music-user-token': musicUserToken,
        'content-type': 'application/json',
      };
      const name = compactName(detail.title);
      const description = `由渡口从${platformName(
        detail.sourcePlatform,
      )}迁移，共 ${detail.items.length} 首，匹配 ${trackIds.length} 首。`.slice(
        0,
        240,
      );
      const firstChunk = trackIds.slice(0, MAX_TRACKS_PER_REQUEST);
      let createResponse: Response;
      try {
        createResponse = await this.fetchWithRetry(
          `${APPLE_API}/v1/me/library/playlists`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              attributes: { name, description },
              relationships: {
                tracks: {
                  data: firstChunk.map((id) => ({ id, type: 'songs' })),
                },
              },
            }),
          },
          25_000,
        );
      } catch {
        throw new BadGatewayException(
          '连接 Apple Music 超时，歌单没有创建，请稍后重试。',
        );
      }
      await this.assertWriteResponse(createResponse, '创建资料库歌单');

      const created = (await createResponse.json()) as AppleTrackPage;
      const libraryPlaylistId = created.data?.[0]?.id;
      if (!libraryPlaylistId) {
        throw new BadGatewayException('Apple Music 没有返回新歌单 ID。');
      }

      let added = firstChunk.length;
      let failed = 0;
      let warning: string | null = null;

      for (
        let offset = firstChunk.length;
        offset < trackIds.length;
        offset += MAX_TRACKS_PER_REQUEST
      ) {
        const chunk = trackIds.slice(offset, offset + MAX_TRACKS_PER_REQUEST);
        const outcome = await this.addChunkResilient(
          libraryPlaylistId,
          chunk,
          headers,
        );
        added += outcome.added;
        failed += outcome.failed;
        if (outcome.networkFailed) {
          failed += trackIds.length - (offset + chunk.length);
          warning =
            '写入过程中网络中断或被 Apple Music 限流，剩余曲目没有写入。歌单已创建，可稍后重试或到 Apple Music 中手动补歌。';
          break;
        }
        if (outcome.authFailed) {
          failed += trackIds.length - (offset + chunk.length);
          warning =
            'Apple Music 授权在写入过程中失效，剩余曲目没有写入。请重新连接后重试。';
          break;
        }
      }

      return {
        platform: 'apple',
        playlistId: libraryPlaylistId,
        name,
        url: `https://music.apple.com/library/playlist/${libraryPlaylistId}`,
        added,
        skipped: detail.items.length - trackIds.length,
        failed,
        warning,
      };
    } finally {
      this.inFlight.delete(lockKey);
    }
  }

  private appleTrackIds(detail: PlaylistDetail): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const item of detail.items) {
      const match = item.matches.find(
        (entry) => entry.platform === 'apple' && entry.status === 'matched',
      );
      const id = match?.remoteId?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  private async addChunkResilient(
    playlistId: string,
    chunk: string[],
    headers: Record<string, string>,
  ): Promise<{
    added: number;
    failed: number;
    authFailed: boolean;
    networkFailed: boolean;
  }> {
    let response: Response;
    try {
      response = await this.postTracks(playlistId, chunk, headers);
    } catch {
      return {
        added: 0,
        failed: chunk.length,
        authFailed: false,
        networkFailed: true,
      };
    }
    if (response.ok) {
      return { added: chunk.length, failed: 0, authFailed: false, networkFailed: false };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        added: 0,
        failed: chunk.length,
        authFailed: true,
        networkFailed: false,
      };
    }
    if (response.status === 429) {
      return {
        added: 0,
        failed: chunk.length,
        authFailed: false,
        networkFailed: true,
      };
    }

    let added = 0;
    let failed = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      let one: Response;
      try {
        one = await this.postTracks(playlistId, [chunk[index]], headers);
      } catch {
        failed += 1;
        continue;
      }
      if (one.ok) {
        added += 1;
        continue;
      }
      failed += 1;
      if (one.status === 401 || one.status === 403) {
        failed += chunk.length - index - 1;
        return {
          added,
          failed,
          authFailed: true,
          networkFailed: false,
        };
      }
    }
    return { added, failed, authFailed: false, networkFailed: false };
  }

  private postTracks(
    playlistId: string,
    ids: string[],
    headers: Record<string, string>,
  ): Promise<Response> {
    return this.fetchWithRetry(
      `${APPLE_API}/v1/me/library/playlists/${playlistId}/tracks`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: ids.map((id) => ({ id, type: 'songs' })),
        }),
      },
      20_000,
    );
  }

  private async appleFetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    action: string,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BadGatewayException(
        `连接 Apple Music 失败（${action}），请稍后重试。`,
      );
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    let response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 429) {
      await delay(1_000);
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    }
    return response;
  }

  private async assertWriteResponse(
    response: Response,
    action: string,
  ): Promise<void> {
    if (response.ok) return;
    const detail = await this.readError(response);
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        'Apple Music 授权已过期，或该账号没有有效的 Apple Music 订阅，请重新连接。',
      );
    }
    if (response.status === 429) {
      throw new BadGatewayException('Apple Music 限流，请稍后重试。');
    }
    throw new BadGatewayException(
      `Apple Music ${action}失败（${response.status}）：${detail}`,
    );
  }

  private async readError(response: Response): Promise<string> {
    const text = await response.text();
    try {
      const payload = JSON.parse(text) as AppleErrorPayload;
      const first = payload.errors?.[0];
      return (
        first?.detail ??
        first?.title ??
        `Apple Music 返回 ${response.status}`
      ).slice(0, 200);
    } catch {
      return text.slice(0, 200) || `Apple Music 返回 ${response.status}`;
    }
  }

  private safeConfiguredNote(): string | null {
    try {
      return this.tokens.configuredNote();
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'Apple Music 开发者令牌不可用。';
    }
  }
}
