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
import type { PlaylistDetail } from '../playlists/playlists.service';
import {
  AccountPushResult,
  AccountQr,
  AccountQrStatus,
  AccountStatus,
} from './account.types';
import {
  chunkArray,
  compactPlaylistName,
  neteaseIdFromUrl,
  normalizeCookie,
  uniqueNumericIds,
} from './account.utils';

type ApiResponse = {
  status?: number;
  body?: Record<string, unknown>;
  cookie?: string | string[];
};

type ApiFunction = (query: Record<string, unknown>) => Promise<ApiResponse>;

interface NeteaseApiModule {
  login_qr_key: ApiFunction;
  login_qr_create: ApiFunction;
  login_qr_check: ApiFunction;
  login_status: ApiFunction;
  playlist_create: ApiFunction;
  playlist_tracks: ApiFunction;
}

// NeteaseCloudMusicApi is a CommonJS package without TypeScript declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const neteaseApi = require('NeteaseCloudMusicApi') as NeteaseApiModule;

interface NeteaseSession {
  cookie: string;
  nickname: string | null;
}

const QR_TTL_MS = 5 * 60_000;
const TRACK_BATCH = 100;

@Injectable()
export class NeteaseAccountService {
  private readonly pending = new Map<string, { cookie: string; expiresAt: number }>();

  constructor(
    @InjectRepository(PlatformCredential)
    private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher,
  ) {}

  async status(userId: string): Promise<AccountStatus> {
    const row = await this.credentials.findOne({
      where: { userId, platform: 'netease' },
    });
    if (!row) {
      return {
        platform: 'netease',
        connected: false,
        nickname: null,
        connectedAt: null,
      };
    }
    try {
      const session = this.parseSession(this.cipher.decrypt(row.encryptedToken));
      return {
        platform: 'netease',
        connected: Boolean(session.cookie),
        nickname: session.nickname,
        connectedAt: row.createdAt,
      };
    } catch {
      return {
        platform: 'netease',
        connected: false,
        nickname: null,
        connectedAt: null,
      };
    }
  }

  async startQr(): Promise<AccountQr> {
    this.cleanupPending();
    const keyResponse = await neteaseApi.login_qr_key({});
    const unikey =
      (keyResponse.body?.data as { unikey?: string } | undefined)?.unikey ??
      (keyResponse.body?.unikey as string | undefined);
    if (!unikey) {
      throw new BadGatewayException('网易云没有返回二维码标识，请稍后重试。');
    }

    const qrResponse = await neteaseApi.login_qr_create({
      key: unikey,
      qrimg: true,
    });
    const data = qrResponse.body?.data as
      | { qrimg?: string; qrurl?: string }
      | undefined;
    if (!data?.qrimg) {
      throw new BadGatewayException('网易云没有返回二维码图片，请稍后重试。');
    }

    this.pending.set(unikey, {
      cookie: normalizeCookie(keyResponse.cookie),
      expiresAt: Date.now() + QR_TTL_MS,
    });

    return {
      platform: 'netease',
      key: unikey,
      image: data.qrimg,
      url: data.qrurl ?? null,
      expiresAt: new Date(Date.now() + QR_TTL_MS),
    };
  }

  async checkQr(userId: string, key: string): Promise<AccountQrStatus> {
    const pending = this.pending.get(key);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pending.delete(key);
      return { status: 'expired', message: '二维码已过期，请重新生成。' };
    }

    const response = await neteaseApi.login_qr_check({
      key,
      cookie: pending.cookie || undefined,
    });
    const body = (response.body ?? {}) as { code?: number; message?: string; cookie?: string };
    const code = Number(body.code ?? 0);

    if (code === 801) return { status: 'waiting' };
    if (code === 802) return { status: 'scanned' };
    if (code !== 803) {
      this.pending.delete(key);
      return { status: 'expired', message: body.message || '二维码已失效。' };
    }

    const cookie = normalizeCookie(body.cookie ?? response.cookie);
    if (!cookie) {
      throw new BadGatewayException('网易云登录成功，但没有返回会话 Cookie。');
    }

    const profile = await this.fetchProfile(cookie);
    await this.saveSession(userId, { cookie, nickname: profile.nickname });
    this.pending.delete(key);
    return { status: 'authorized', nickname: profile.nickname };
  }

  async disconnect(userId: string): Promise<{ ok: true }> {
    await this.credentials.delete({ userId, platform: 'netease' });
    return { ok: true };
  }

  async push(
    userId: string,
    detail: PlaylistDetail,
    name?: string,
  ): Promise<AccountPushResult> {
    const session = await this.readSession(userId);
    const targetIds = uniqueNumericIds(
      detail.items.map((item) => {
        const match = item.matches.find(
          (entry) => entry.platform === 'netease' && entry.status === 'matched',
        );
        if (match?.remoteId) return match.remoteId;
        if (item.sourcePlatform === 'netease') return neteaseIdFromUrl(item.sourceUrl);
        return null;
      }),
    );

    if (targetIds.length === 0) {
      throw new BadRequestException(
        '还没有可写入的网易云曲目。先在「送达」里匹配到网易云，或从网易云歌单导入。',
      );
    }

    const playlistName = compactPlaylistName(name ?? detail.title, 40);
    const create = await neteaseApi.playlist_create({
      name: playlistName,
      privacy: '10',
      cookie: session.cookie,
    });
    const createRaw = (create.body ?? {}) as {
      code?: number;
      id?: string | number;
      playlist?: { id?: string | number };
      message?: string;
      body?: {
        code?: number;
        id?: string | number;
        playlist?: { id?: string | number };
        message?: string;
      };
    };
    const createBody = createRaw.body ?? createRaw;
    if (Number(createBody.code ?? 0) === 301 || Number(createBody.code ?? 0) === 401) {
      throw new UnauthorizedException('网易云登录已过期，请重新扫码。');
    }
    const playlistId = createBody.id ?? createBody.playlist?.id;
    if (!playlistId) {
      throw new BadGatewayException(
        `网易云创建歌单失败（${createBody.code ?? '未知'}）：${createBody.message ?? '没有返回歌单 ID'}`,
      );
    }

    let added = 0;
    let failed = 0;
    for (const chunk of chunkArray(targetIds, TRACK_BATCH)) {
      const response = await neteaseApi.playlist_tracks({
        op: 'add',
        pid: String(playlistId),
        tracks: chunk.join(','),
        cookie: session.cookie,
        crypto: 'weapi',
      });
      const raw = (response.body ?? {}) as {
        code?: number;
        message?: string;
        body?: { code?: number; message?: string };
      };
      const body = raw.body ?? raw;
      const code = Number(body.code ?? 0);
      if (code === 301 || code === 401) {
        throw new UnauthorizedException('网易云登录已过期，请重新扫码。');
      }
      if (code !== 200) {
        failed += chunk.length;
        break;
      }
      added += chunk.length;
    }

    return {
      platform: 'netease',
      playlistId: String(playlistId),
      name: playlistName,
      url: `https://music.163.com/#/playlist?id=${playlistId}`,
      added,
      skipped: detail.items.length - targetIds.length,
      failed,
    };
  }

  private async fetchProfile(cookie: string): Promise<{ nickname: string | null }> {
    try {
      const response = await neteaseApi.login_status({ cookie });
      const body = (response.body ?? {}) as {
        data?: { profile?: { nickname?: string } };
        profile?: { nickname?: string };
      };
      const nickname =
        body.data?.profile?.nickname ?? body.profile?.nickname ?? null;
      return { nickname };
    } catch {
      return { nickname: null };
    }
  }

  private async saveSession(userId: string, session: NeteaseSession): Promise<void> {
    const row =
      (await this.credentials.findOne({
        where: { userId, platform: 'netease' },
      })) ?? this.credentials.create({ userId, platform: 'netease' });
    row.encryptedToken = this.cipher.encrypt(JSON.stringify(session));
    row.storefront = 'cn';
    row.tokenExpiresAt = null;
    await this.credentials.save(row);
  }

  private async readSession(userId: string): Promise<NeteaseSession> {
    const row = await this.credentials.findOne({
      where: { userId, platform: 'netease' },
    });
    if (!row) {
      throw new UnauthorizedException('还没有连接网易云，请先扫码登录。');
    }
    try {
      const session = this.parseSession(this.cipher.decrypt(row.encryptedToken));
      if (!session.cookie) throw new Error('missing cookie');
      return session;
    } catch {
      throw new UnauthorizedException('网易云登录态已损坏，请重新扫码。');
    }
  }

  private parseSession(value: string): NeteaseSession {
    const parsed = JSON.parse(value) as Partial<NeteaseSession>;
    return {
      cookie: typeof parsed.cookie === 'string' ? parsed.cookie : '',
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : null,
    };
  }

  private cleanupPending(): void {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt < now) this.pending.delete(key);
    }
  }
}
