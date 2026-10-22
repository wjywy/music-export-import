import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
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
  cookieValue,
  qqMidFromUrl,
  uniqueNumericIds,
} from './account.utils';

interface QQSession {
  token: string;
  nickname: string | null;
}

interface QQResponse {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

interface QQEnv {
  QQ_SESSION_SECRET: string;
  QQ_PTLOGIN_HTTP_ENABLED: string;
}

interface QQServerless {
  handleRequest(request: Request, env?: QQEnv): Promise<Response>;
}

// The package uses an exports map that this CommonJS tsconfig cannot resolve.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const qqServerless = require('@yakult-green-tea/qq-music-api/serverless') as QQServerless;

const QR_TTL_MS = 5 * 60_000;
const TRACK_BATCH = 100;
const RESOLVE_BATCH = 20;

@Injectable()
export class QqAccountService {
  constructor(
    @InjectRepository(PlatformCredential)
    private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher,
  ) {}

  async status(userId: string): Promise<AccountStatus> {
    const row = await this.credentials.findOne({
      where: { userId, platform: 'qq' },
    });
    if (!row) {
      return { platform: 'qq', connected: false, nickname: null, connectedAt: null };
    }
    try {
      const session = this.parseSession(this.cipher.decrypt(row.encryptedToken));
      return {
        platform: 'qq',
        connected: Boolean(session.token),
        nickname: session.nickname,
        connectedAt: row.createdAt,
      };
    } catch {
      return { platform: 'qq', connected: false, nickname: null, connectedAt: null };
    }
  }

  async startQr(): Promise<AccountQr> {
    const keyResponse = await this.call('/login/qr/key?channel=qq');
    const key = (keyResponse.body.data as { unikey?: string } | undefined)?.unikey;
    if (!key) {
      throw new BadGatewayException(
        (keyResponse.body.message as string | undefined) ??
          'QQ 音乐没有返回二维码标识，请稍后重试。',
      );
    }

    const qrResponse = await this.call(
      `/login/qr/create?key=${encodeURIComponent(key)}`,
    );
    const data = qrResponse.body.data as
      | { qrimg?: string; qrurl?: string }
      | undefined;
    if (!data?.qrimg) {
      throw new BadGatewayException('QQ 音乐没有返回二维码图片，请稍后重试。');
    }

    return {
      platform: 'qq',
      key,
      image: data.qrimg,
      url: data.qrurl ?? null,
      expiresAt: new Date(Date.now() + QR_TTL_MS),
    };
  }

  async checkQr(userId: string, key: string): Promise<AccountQrStatus> {
    const response = await this.call(
      `/login/qr/check?key=${encodeURIComponent(key)}`,
    );
    const body = response.body as {
      code?: number;
      message?: string;
      cookie?: string;
    };
    const code = Number(body.code ?? 0);

    if (code === 801) return { status: 'waiting' };
    if (code === 802) return { status: 'scanned' };
    if (code !== 803) {
      return { status: 'expired', message: body.message || '二维码已失效。' };
    }

    const token =
      cookieValue(body.cookie, 'qqmusic_session') ??
      cookieValue(response.setCookie, 'qqmusic_session');
    if (!token) {
      throw new BadGatewayException('QQ 音乐登录成功，但没有返回会话 token。');
    }

    const profile = await this.fetchProfile(token);
    await this.saveSession(userId, { token, nickname: profile.nickname });
    return { status: 'authorized', nickname: profile.nickname };
  }

  async disconnect(userId: string): Promise<{ ok: true }> {
    await this.credentials.delete({ userId, platform: 'qq' });
    return { ok: true };
  }

  async push(
    userId: string,
    detail: PlaylistDetail,
    name?: string,
  ): Promise<AccountPushResult> {
    const session = await this.readSession(userId);
    const mids = this.collectMids(detail);
    if (mids.length === 0) {
      throw new BadRequestException(
        '还没有可写入的 QQ 音乐曲目。先在「送达」里匹配到 QQ 音乐，或从 QQ 音乐歌单导入。',
      );
    }

    const numericIds = await this.resolveNumericIds(mids, session.token);
    if (numericIds.length === 0) {
      throw new BadGatewayException('QQ 音乐没有解析出可写入的歌曲 ID。');
    }

    const playlistName = compactPlaylistName(name ?? detail.title, 20);
    const create = await this.call(
      '/user/playlist/create',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: playlistName }),
      },
      session.token,
    );
    const created = (create.body.data ?? create.body) as
      | { tid?: number; name?: string }
      | undefined;
    const tid = created?.tid;
    const createdName = created?.name ?? playlistName;
    if (!tid) {
      throw new BadGatewayException(
        `QQ 音乐创建歌单失败（${String(create.body.code ?? create.status)}）：${
          (create.body.message as string | undefined) ?? '没有返回歌单 ID'
        }`,
      );
    }

    let added = 0;
    let skipped = detail.items.length - numericIds.length;
    let failed = 0;

    for (const chunk of chunkArray(numericIds, TRACK_BATCH)) {
      const response = await this.call(
        '/user/playlist/tracks',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tid,
            op: 'add',
            songs: chunk.map((id) => ({ id: Number(id), type: 0 })),
          }),
        },
        session.token,
      );
      if (response.status === 401) {
        throw new UnauthorizedException('QQ 音乐登录已过期，请重新扫码。');
      }
      const data = response.body.data as
        | { changed?: boolean; verification?: { status?: string } }
        | undefined;
      if (response.status !== 200 || Number(response.body.code ?? 0) !== 200) {
        failed += chunk.length;
        break;
      }
      if (data?.changed === false) {
        skipped += chunk.length;
      } else {
        added += chunk.length;
      }
    }

    return {
      platform: 'qq',
      playlistId: String(tid),
      name: createdName,
      url: `https://y.qq.com/n/ryqq/playlist/${tid}`,
      added,
      skipped,
      failed,
    };
  }

  private collectMids(detail: PlaylistDetail): string[] {
    const seen = new Set<string>();
    const mids: string[] = [];
    for (const item of detail.items) {
      const match = item.matches.find(
        (entry) => entry.platform === 'qq' && entry.status === 'matched',
      );
      const mid =
        match?.remoteId ??
        (item.sourcePlatform === 'qq' ? qqMidFromUrl(item.sourceUrl) : null);
      const value = (mid ?? '').trim();
      if (!value || value === '0' || seen.has(value)) continue;
      seen.add(value);
      mids.push(value);
    }
    return mids;
  }

  private async resolveNumericIds(
    mids: string[],
    token: string,
  ): Promise<string[]> {
    const direct = uniqueNumericIds(mids);
    const needResolve = mids.filter((mid) => !/^\d{1,20}$/.test(mid));
    if (direct.length === mids.length) return direct;

    const resolved: string[] = [...direct];
    for (const chunk of chunkArray(needResolve, RESOLVE_BATCH)) {
      const response = await this.call(
        '/song/batch',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ songs: chunk.map((mid) => ({ mid })) }),
        },
        token,
      );
      const payload = (response.body.data ?? response.body) as {
        results?: { code?: number; song?: { id?: number } }[];
      };
      for (const result of payload.results ?? []) {
        if (result.code === 200 && result.song?.id) {
          resolved.push(String(result.song.id));
        }
      }
    }

    return uniqueNumericIds(resolved);
  }

  private async fetchProfile(token: string): Promise<{ nickname: string | null }> {
    try {
      const response = await this.call('/login/status', undefined, token);
      const data = response.body.data as
        | {
            profile?: {
              nick?: string;
              nickname?: string;
              name?: string;
              info?: { nick?: string };
            };
          }
        | undefined;
      const profile = data?.profile;
      return {
        nickname:
          profile?.nick ??
          profile?.info?.nick ??
          profile?.nickname ??
          profile?.name ??
          null,
      };
    } catch {
      return { nickname: null };
    }
  }

  private async call(
    path: string,
    init?: RequestInit,
    token?: string,
  ): Promise<QQResponse> {
    const headers = new Headers(init?.headers);
    if (token) headers.set('x-qq-session', token);
    const request = new Request(`http://dukou.local${path}`, {
      ...init,
      headers,
    });
    const response = await qqServerless.handleRequest(request, this.env());
    const text = await response.text();
    let body: Record<string, unknown> = {};
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = { message: text.slice(0, 200) };
      }
    }
    return {
      status: response.status,
      body,
      setCookie: response.headers.get('set-cookie'),
    };
  }

  private env(): QQEnv {
    const base =
      process.env.QQ_SESSION_SECRET?.trim() ||
      process.env.CREDENTIALS_SECRET?.trim() ||
      process.env.JWT_SECRET?.trim() ||
      'dukou-development-secret';
    return {
      QQ_SESSION_SECRET: createHash('sha256').update(base).digest('hex'),
      QQ_PTLOGIN_HTTP_ENABLED: '1',
    };
  }

  private async saveSession(userId: string, session: QQSession): Promise<void> {
    const row =
      (await this.credentials.findOne({
        where: { userId, platform: 'qq' },
      })) ?? this.credentials.create({ userId, platform: 'qq' });
    row.encryptedToken = this.cipher.encrypt(JSON.stringify(session));
    row.storefront = 'cn';
    row.tokenExpiresAt = null;
    await this.credentials.save(row);
  }

  private async readSession(userId: string): Promise<QQSession> {
    const row = await this.credentials.findOne({
      where: { userId, platform: 'qq' },
    });
    if (!row) {
      throw new UnauthorizedException('还没有连接 QQ 音乐，请先扫码登录。');
    }
    try {
      const session = this.parseSession(this.cipher.decrypt(row.encryptedToken));
      if (!session.token) throw new Error('missing token');
      return session;
    } catch {
      throw new UnauthorizedException('QQ 音乐登录态已损坏，请重新扫码。');
    }
  }

  private parseSession(value: string): QQSession {
    const parsed = JSON.parse(value) as Partial<QQSession>;
    return {
      token: typeof parsed.token === 'string' ? parsed.token : '',
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : null,
    };
  }
}
