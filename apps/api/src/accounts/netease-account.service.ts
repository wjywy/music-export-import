import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
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
  neteaseIdFromUrl,
  normalizeCookie,
  scanLoginChainId,
  scanLoginUrl,
  uniqueNumericIds,
} from './account.utils';
import { closeQrSession, openQrSession, type BrowserQrSession } from './netease-qr-browser';

type ApiResponse = {
  status?: number;
  body?: Record<string, unknown>;
  cookie?: string | string[];
};

type ApiFunction = (query: Record<string, unknown>) => Promise<ApiResponse>;

type RawRequest = (
  uri: string,
  data: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<ApiResponse>;

interface NeteaseApiModule {
  login_status: ApiFunction;
  playlist_create: ApiFunction;
  playlist_tracks: ApiFunction;
}

// NeteaseCloudMusicApi is a CommonJS package without TypeScript declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const neteaseApi = require('NeteaseCloudMusicApi') as NeteaseApiModule;
// The QR login has to mirror music.163.com exactly (type 1 + chainId), which
// the high-level helpers do not expose, so those two calls use the raw client.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const neteaseRequest = require('NeteaseCloudMusicApi/util/request') as RawRequest;

interface NeteaseSession {
  cookie: string;
  nickname: string | null;
}

const QR_TTL_MS = 5 * 60_000;
const TRACK_BATCH = 500;

const WEB_HEADERS: Record<string, string> = {
  'x-os': 'web',
  'x-channelsource': 'undefined',
};

@Injectable()
export class NeteaseAccountService {
  private readonly browserSessions = new Map<
    string,
    { userId: string; session: BrowserQrSession; timer: NodeJS.Timeout }
  >();

  private readonly pending = new Map<
    string,
    { cookie: string; chainId: string; expiresAt: number }
  >();

  constructor(
    @InjectRepository(PlatformCredential)
    private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher,
  ) {}

  async cookieFor(userId: string): Promise<string | null> {
    try {
      return (await this.readSession(userId)).cookie;
    } catch {
      return null;
    }
  }

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

  async startQr(userId: string): Promise<AccountQr> {
    if (process.env.CHROME_PATH?.trim()) return this.startBrowserQr(userId);

    this.cleanupPending();

    // The request library regenerates these IDs on each call unless supplied.
    // Keep one anonymous session from QR creation through confirmation.
    const visitorId = randomBytes(32).toString('hex');
    const visitorCookie = `_ntes_nuid=${visitorId}; _ntes_nnid=${visitorId},${Date.now()}`;
    // type: 1 is what music.163.com itself uses for the web QR; the library
    // default (3) is the legacy app flow that NetEase now flags.
    const keyResponse = await neteaseRequest(
      '/api/login/qrcode/unikey',
      { type: 1 },
      { crypto: 'weapi', cookie: visitorCookie, headers: WEB_HEADERS },
    );
    const keyBody = (keyResponse.body ?? {}) as {
      unikey?: string;
      data?: { unikey?: string };
    };
    const unikey = keyBody.data?.unikey ?? keyBody.unikey;
    if (!unikey) {
      throw new BadGatewayException('网易云没有返回二维码标识，请稍后重试。');
    }

    const cookie = normalizeCookie([visitorCookie, normalizeCookie(keyResponse.cookie)]);
    const chainId = scanLoginChainId(cookie);
    const url = scanLoginUrl(unikey, chainId);
    const image = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 360,
    });

    this.pending.set(unikey, {
      cookie,
      chainId,
      expiresAt: Date.now() + QR_TTL_MS,
    });

    return {
      platform: 'netease',
      key: unikey,
      image,
      url,
      expiresAt: new Date(Date.now() + QR_TTL_MS),
    };
  }

  async checkQr(userId: string, key: string): Promise<AccountQrStatus> {
    const browser = this.browserSessions.get(key);
    if (browser?.userId === userId) {
      const { session } = browser;
      if (session.status !== 'authorized') return { status: session.status };
      if (!session.cookie || !cookieValue(session.cookie, 'MUSIC_U')) {
        await this.removeBrowserQr(key);
        throw new BadGatewayException('网易云登录成功，但没有返回会话 Cookie。');
      }
      const profile = await this.requireProfile(session.cookie);
      await this.saveSession(userId, { cookie: session.cookie, nickname: profile.nickname });
      await this.removeBrowserQr(key);
      return { status: 'authorized', nickname: profile.nickname };
    }

    const pending = this.pending.get(key);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pending.delete(key);
      return { status: 'expired', message: '二维码已过期，请重新生成。' };
    }

    const response = await neteaseRequest(
      '/api/login/qrcode/client/login',
      { key, type: 1 },
      {
        crypto: 'weapi',
        cookie: pending.cookie || undefined,
        headers: {
          ...WEB_HEADERS,
          'nm-gcore-status': '1',
          'x-loginmethod': 'QrCode',
          'x-login-chain-id': pending.chainId,
        },
      },
    );
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

  private async startBrowserQr(userId: string): Promise<AccountQr> {
    const session = await openQrSession();
    if (!session) throw new BadGatewayException('无法打开网易云登录页，请稍后重试。');

    try {
      const url = scanLoginUrl(session.unikey, session.chainId);
      const image = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 360 });
      const expiresAt = new Date(Date.now() + QR_TTL_MS);
      const timer = setTimeout(() => void this.removeBrowserQr(session.unikey), QR_TTL_MS);
      timer.unref();
      this.browserSessions.set(session.unikey, { userId, session, timer });
      return { platform: 'netease', key: session.unikey, image, url, expiresAt };
    } catch (error) {
      await closeQrSession(session);
      throw error;
    }
  }

  private async removeBrowserQr(key: string): Promise<void> {
    const entry = this.browserSessions.get(key);
    if (!entry) return;
    this.browserSessions.delete(key);
    clearTimeout(entry.timer);
    await closeQrSession(entry.session);
  }

  async disconnect(userId: string): Promise<{ ok: true }> {
    await this.credentials.delete({ userId, platform: 'netease' });
    return { ok: true };
  }

  /**
   * Cookie login is the fallback for people whose scan is stopped by NetEase's
   * risk control ("检测到当前设备环境异常"): the browser session is already
   * trusted, so the tool only has to prove it is still valid before storing it.
   */
  async connectWithCookie(
    userId: string,
    rawCookie: string,
  ): Promise<AccountStatus> {
    const cookie = normalizeCookie(rawCookie);
    if (!cookieValue(cookie, 'MUSIC_U')) {
      throw new BadRequestException(
        'Cookie 里没有 MUSIC_U。请在浏览器登录 music.163.com 后复制完整 Cookie。',
      );
    }

    const profile = await this.requireProfile(cookie);
    await this.saveSession(userId, { cookie, nickname: profile.nickname });
    return this.status(userId);
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

  /** Same call as fetchProfile, but tells the user when the cookie is dead. */
  private async requireProfile(
    cookie: string,
  ): Promise<{ nickname: string | null }> {
    let response: ApiResponse;
    try {
      response = await neteaseApi.login_status({ cookie });
    } catch {
      throw new BadGatewayException('连接网易云失败，请稍后再试。');
    }

    const body = (response.body ?? {}) as {
      data?: { code?: number; profile?: { nickname?: string } };
      code?: number;
      profile?: { nickname?: string };
    };
    const data = body.data ?? body;
    if (Number(data.code ?? 0) !== 200 || !data.profile) {
      throw new UnauthorizedException(
        '这个 Cookie 登不上网易云，可能已经过期。请重新在浏览器里登录后再复制。',
      );
    }

    return { nickname: data.profile.nickname ?? null };
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
