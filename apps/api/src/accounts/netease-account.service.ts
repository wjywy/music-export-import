import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
  scanLoginUrl,
  uniqueNumericIds,
} from './account.utils';
import type { BrowserQrSession } from './netease-qr-browser';
import { NeteaseQrPool } from './netease-qr-pool';
import { NeteaseOpenApiAccountService } from './netease-openapi-account.service';
import type { ParsedRef, PlatformAdapter, RemotePlaylist } from '../platforms/adapter.interface';

type ApiResponse = {
  status?: number;
  body?: Record<string, unknown>;
  cookie?: string | string[];
};

type ApiFunction = (query: Record<string, unknown>) => Promise<ApiResponse>;

interface NeteaseApiModule {
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

const TRACK_BATCH = 500;

@Injectable()
export class NeteaseAccountService {
  private readonly browserStarts = new Map<string, Promise<AccountQr>>();
  private readonly browserCompletions = new Map<
    string,
    { userId: string; completion: Promise<AccountQrStatus> }
  >();

  private readonly browserSessions = new Map<
    string,
    {
      userId: string;
      session: BrowserQrSession;
      qr: AccountQr;
      timer: NodeJS.Timeout;
      completion?: Promise<AccountQrStatus>;
    }
  >();

  constructor(
    @InjectRepository(PlatformCredential)
    private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher,
    private readonly qrPool: NeteaseQrPool,
    private readonly official?: NeteaseOpenApiAccountService,
  ) {}

  async cookieFor(userId: string): Promise<string | null> {
    try {
      return (await this.readSession(userId)).cookie;
    } catch {
      return null;
    }
  }

  async status(userId: string): Promise<AccountStatus> {
    if (this.official?.enabled) return this.official.status(userId);
    const row = await this.credentials.findOne({
      where: { userId, platform: 'netease' },
    });
    if (!row) {
      this.qrPool.prepare();
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
    if (this.official?.enabled) return this.official.startQr(userId);
    const existing = this.browserStarts.get(userId);
    if (existing) return existing;
    const start = this.startBrowserQr(userId).finally(() => this.browserStarts.delete(userId));
    this.browserStarts.set(userId, start);
    return start;
  }

  async checkQr(userId: string, key: string): Promise<AccountQrStatus> {
    if (this.official?.enabled) return this.official.checkQr(userId, key);
    const browser = this.browserSessions.get(key);
    if (browser?.userId === userId) {
      const { session } = browser;
      if (session.status === 'expired' || session.expiresAt <= Date.now()) {
        await this.removeBrowserQr(key);
        return { status: 'expired', message: session.message || '二维码已过期，请重新生成。' };
      }
      if (session.status !== 'authorized') return { status: session.status };
      if (!session.cookie || !cookieValue(session.cookie, 'MUSIC_U')) {
        await this.removeBrowserQr(key);
        throw new BadGatewayException('网易云登录成功，但没有返回会话 Cookie。');
      }
      if (!browser.completion) {
        const completion = this.completeBrowserQr(userId, key, session.cookie)
          .finally(() => this.browserCompletions.delete(key));
        this.browserCompletions.set(key, { userId, completion });
        browser.completion = completion;
      }
      try {
        return await browser.completion;
      } catch (error) {
        browser.completion = undefined;
        throw error;
      }
    }

    return { status: 'expired', message: '二维码已过期，请重新生成。' };
  }

  private async completeBrowserQr(
    userId: string,
    key: string,
    cookie: string,
  ): Promise<AccountQrStatus> {
    const profile = await this.requireProfile(cookie);
    await this.saveSession(userId, { cookie, nickname: profile.nickname });
    await this.removeBrowserQr(key);
    return { status: 'authorized', nickname: profile.nickname };
  }

  private async startBrowserQr(userId: string): Promise<AccountQr> {
    for (const [key, entry] of this.browserSessions) {
      if (entry.userId !== userId) continue;
      if (entry.session.status !== 'expired' && entry.session.expiresAt > Date.now()) {
        return entry.qr;
      }
      await this.removeBrowserQr(key);
    }
    const session = await this.qrPool.acquire();

    try {
      const url = scanLoginUrl(session.unikey, session.chainId);
      const image = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 360 });
      const expiresAt = new Date(session.expiresAt);
      const qr: AccountQr = { platform: 'netease', key: session.unikey, image, url, expiresAt };
      const timer = setTimeout(
        () => void this.removeBrowserQr(session.unikey),
        Math.max(0, session.expiresAt - Date.now()),
      );
      timer.unref();
      this.browserSessions.set(session.unikey, { userId, session, qr, timer });
      return qr;
    } catch (error) {
      await this.qrPool.release(session);
      throw error;
    }
  }

  private async removeBrowserQr(key: string): Promise<void> {
    const entry = this.browserSessions.get(key);
    if (!entry) return;
    this.browserSessions.delete(key);
    clearTimeout(entry.timer);
    await this.qrPool.release(entry.session);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.browserSessions.keys()].map((key) => this.removeBrowserQr(key)));
  }

  async disconnect(userId: string): Promise<{ ok: true }> {
    if (this.official?.enabled) return this.official.disconnect(userId);
    // Stop new polls before awaiting any in-flight validation.
    const closing = [...this.browserSessions.entries()]
      .filter(([, entry]) => entry.userId === userId)
      .map(([key]) => this.removeBrowserQr(key));
    // Expiry can remove a QR context while its account validation is still running.
    await Promise.all([...closing, ...[...this.browserCompletions.values()]
      .filter((entry) => entry.userId === userId)
      .map((entry) => entry.completion.catch(() => undefined))]);
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
    if (await this.official?.ownsSession(userId)) return this.official!.push(userId, detail, name);
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

  async fetchPlaylist(userId: string, ref: ParsedRef, adapter: PlatformAdapter): Promise<RemotePlaylist> {
    if (await this.official?.ownsSession(userId)) {
      return this.official!.fetchPlaylist(userId, ref, () => adapter.fetchPlaylist(ref));
    }
    const cookie = await this.cookieFor(userId);
    return adapter.fetchPlaylist(ref, cookie ? { cookie } : undefined);
  }

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
}
