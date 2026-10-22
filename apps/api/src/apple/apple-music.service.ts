import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformCredential } from '../common/entities/platform-credential.entity';
import { CredentialCipher } from '../platforms/credential-cipher.service';
import { PlaylistsService } from '../playlists/playlists.service';

const APPLE_API = 'https://api.music.apple.com';
const MAX_TRACKS_PER_REQUEST = 100;

export interface AppleStatus {
  configured: boolean;
  authorized: boolean;
  storefront: string;
  developerToken?: string;
  connectedAt?: Date | null;
  note?: string;
}

@Injectable()
export class AppleMusicService {
  constructor(
    @InjectRepository(PlatformCredential)
    private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher,
    private readonly playlists: PlaylistsService,
  ) {}

  private developerToken(): string | null {
    const token = process.env.APPLE_MUSIC_TOKEN?.trim();
    return token || null;
  }

  private storefront(): string {
    return process.env.APPLE_MUSIC_STOREFRONT?.trim() || 'cn';
  }

  async status(userId: string): Promise<AppleStatus> {
    const configured = Boolean(this.developerToken());
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
      note: configured
        ? undefined
        : '服务端未配置 APPLE_MUSIC_TOKEN，Apple Music 授权与写入不可用。',
    };
  }

  async config(userId: string): Promise<AppleStatus> {
    const status = await this.status(userId);
    return {
      ...status,
      developerToken: status.configured ? (this.developerToken() ?? undefined) : undefined,
    };
  }

  async authorize(
    userId: string,
    musicUserToken: string,
    storefront?: string,
  ): Promise<AppleStatus> {
    const developerToken = this.developerToken();
    if (!developerToken) {
      throw new BadRequestException(
        '服务端未配置 APPLE_MUSIC_TOKEN，无法完成 Apple Music 授权。',
      );
    }

    const response = await fetch(`${APPLE_API}/v1/me/library/playlists?limit=1`, {
      headers: {
        authorization: `Bearer ${developerToken}`,
        'music-user-token': musicUserToken,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        'Apple Music 用户令牌无效、已过期，或账号没有 Apple Music 订阅。',
      );
    }
    if (!response.ok) {
      throw new BadGatewayException(`Apple Music 校验失败（${response.status}）。`);
    }

    const credential =
      (await this.credentials.findOne({
        where: { userId, platform: 'apple' },
      })) ?? this.credentials.create({ userId, platform: 'apple' });
    credential.encryptedToken = this.cipher.encrypt(musicUserToken);
    credential.storefront = storefront ?? this.storefront();
    credential.tokenExpiresAt = null;
    await this.credentials.save(credential);
    return this.status(userId);
  }

  async disconnect(userId: string): Promise<{ ok: true }> {
    await this.credentials.delete({ userId, platform: 'apple' });
    return { ok: true };
  }

  async pushPlaylist(userId: string, playlistId: string) {
    const developerToken = this.developerToken();
    if (!developerToken) {
      throw new BadRequestException('服务端未配置 APPLE_MUSIC_TOKEN。');
    }
    const credential = await this.credentials.findOne({
      where: { userId, platform: 'apple' },
    });
    if (!credential) {
      throw new UnauthorizedException('还没有连接 Apple Music。');
    }
    const musicUserToken = this.cipher.decrypt(credential.encryptedToken);
    const detail = await this.playlists.getDetail(playlistId, userId);

    const trackIds: string[] = [];
    for (const item of detail.items) {
      const match = item.matches.find(
        (entry) => entry.platform === 'apple' && entry.status === 'matched',
      );
      if (match?.remoteId) trackIds.push(match.remoteId);
    }
    if (trackIds.length === 0) {
      throw new BadRequestException(
        '还没有匹配到 Apple Music 的曲目。先在「送达」里匹配到 Apple Music。',
      );
    }

    const headers = {
      authorization: `Bearer ${developerToken}`,
      'music-user-token': musicUserToken,
      'content-type': 'application/json',
    };

    const firstChunk = trackIds.slice(0, MAX_TRACKS_PER_REQUEST);
    const createResponse = await fetch(`${APPLE_API}/v1/me/library/playlists`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        attributes: {
          name: `${detail.title} · 渡口`,
          description: detail.description ?? '由渡口从其他平台迁移。',
        },
        relationships: {
          tracks: {
            data: firstChunk.map((id) => ({ id, type: 'songs' })),
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!createResponse.ok) {
      const text = await createResponse.text();
      throw new BadGatewayException(
        `Apple Music 创建资料库歌单失败（${createResponse.status}）：${text.slice(0, 180)}`,
      );
    }

    const created = (await createResponse.json()) as {
      data?: { id?: string }[];
    };
    const libraryPlaylistId = created.data?.[0]?.id;
    if (!libraryPlaylistId) {
      throw new BadGatewayException('Apple Music 没有返回新歌单 ID。');
    }

    let added = firstChunk.length;
    for (let offset = MAX_TRACKS_PER_REQUEST; offset < trackIds.length; offset += MAX_TRACKS_PER_REQUEST) {
      const chunk = trackIds.slice(offset, offset + MAX_TRACKS_PER_REQUEST);
      const response = await fetch(
        `${APPLE_API}/v1/me/library/playlists/${libraryPlaylistId}/tracks`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ data: chunk.map((id) => ({ id, type: 'songs' })) }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) {
        break;
      }
      added += chunk.length;
    }

    return {
      libraryPlaylistId,
      name: `${detail.title} · 渡口`,
      added,
      skipped: detail.items.length - trackIds.length,
      libraryUrl: `https://music.apple.com/library/playlist/${libraryPlaylistId}`,
    };
  }
}
