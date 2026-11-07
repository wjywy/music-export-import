import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPrivateKey, createSign, randomUUID, type KeyObject } from 'node:crypto';
import { arch, networkInterfaces, platform, release } from 'node:os';

// Endpoint and parameter contracts match @music163/ncm-cli's signed API manifest.
export const NETEASE_OPENAPI = {
  anonymous: '/openapi/music/basic/oauth2/login/anonymous',
  qr: '/openapi/music/basic/user/oauth2/qrcodekey/get/v2',
  poll: '/openapi/music/basic/oauth2/device/login/qrcode/get',
  exchange: '/openapi/music/basic/user/oauth2/token/get/v2',
  profile: '/openapi/music/basic/user/profile/get/v2',
  refresh: '/openapi/music/basic/user/oauth2/token/refresh/v2',
  searchSongs: '/openapi/music/basic/search/song/get/v3',
  searchPlaylists: '/openapi/music/basic/search/playlist/get/v2',
  created: '/openapi/music/basic/playlist/created/get/v2',
  collected: '/openapi/music/basic/playlist/subed/get/v2',
  playlist: '/openapi/music/basic/playlist/detail/get/v2',
  tracks: '/openapi/music/basic/playlist/song/list/get/v3',
  create: '/openapi/music/basic/playlist/create',
  add: '/openapi/music/basic/playlist/song/batch/like',
} as const;

export type OpenApiEndpoint = typeof NETEASE_OPENAPI[keyof typeof NETEASE_OPENAPI];
export type OpenApiDevice = Record<string, string> & { deviceId: string };

export interface OpenApiContext {
  device: OpenApiDevice;
  accessToken: string;
}

export interface OpenApiToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface OpenApiRecord {
  id?: string;
  originalId?: string | number;
  name?: string;
  jumpUrl?: string;
  coverImgUrl?: string | null;
  describe?: string | null;
  creatorNickName?: string;
  trackCount?: number;
  duration?: number;
  artists?: { name?: string }[];
  album?: { name?: string };
  visible?: boolean;
}

export interface OpenApiRecords {
  recordCount?: number;
  records?: OpenApiRecord[];
}

interface TokenResponse {
  accessToken?: string;
  refreshToken?: string;
  expireTime?: number;
  expiresTime?: number;
  expireIn?: number | string;
}

export class NeteaseOpenApiError extends BadGatewayException {
  constructor(readonly upstreamCode: number) {
    super(`网易云官方接口返回错误（${upstreamCode}），请检查应用权限或稍后重试。`);
  }
}

const ORIGIN = 'https://openapi.music.163.com';
const QR_LIFETIME_MS = 300_000;

@Injectable()
export class NeteaseOpenApiClient {
  readonly appId: string;
  readonly qrProvider: 'pc' | 'browser' | 'openapi';
  private readonly redirectUrl: string;
  private readonly clientType: string;
  private readonly appKey: string;
  private readonly privateKey: string;
  private signingKey?: KeyObject;
  private readonly anonymousContexts = new Map<string, Promise<OpenApiContext>>();

  constructor(config: ConfigService) {
    const qrProvider = config.get<string>('NETEASE_QR_PROVIDER', 'pc').trim() || 'pc';
    if (!['pc', 'browser', 'openapi'].includes(qrProvider)) {
      throw new Error('NETEASE_QR_PROVIDER 必须为 pc、browser 或 openapi。');
    }
    this.qrProvider = qrProvider as 'pc' | 'browser' | 'openapi';
    this.redirectUrl = config.get<string>('NETEASE_OPENAPI_REDIRECT_URL', '').trim();
    this.clientType = config.get<string>('NETEASE_OPENAPI_CLIENT_TYPE', 'web').trim();
    this.appId = config.get<string>('NETEASE_OPENAPI_APP_ID', '').trim();
    this.appKey = config.get<string>('NETEASE_OPENAPI_APP_KEY', '').trim();
    this.privateKey = config.get<string>('NETEASE_OPENAPI_PRIVATE_KEY', '').trim();
  }

  get h5Configured(): boolean {
    return Boolean(this.appId && this.privateKey && this.redirectUrl);
  }

  get enabled(): boolean {
    return Boolean(this.appId || this.appKey || this.privateKey);
  }

  newDevice(subject?: string): OpenApiDevice {
    const clientIp = Object.values(networkInterfaces()).flat()
      .find((address) => address?.family === 'IPv4' && !address.internal)?.address ?? '127.0.0.1';
    return {
      // These are OpenAPI's agreed client identifiers, rather than browser fingerprints.
      deviceType: 'openapi', os: 'ncmcli', appVer: '0.1.0', channel: 'ncmcli',
      model: `${platform()}_${arch()}`, brand: 'ncmcli', osVer: release(),
      clientIp,
      deviceId: subject
        ? createHash('sha256').update(JSON.stringify([this.appId, subject])).digest('hex')
        : randomUUID().replace(/-/g, ''),
    };
  }

  private anonymousContext(device: OpenApiDevice): Promise<OpenApiContext> {
    const existing = this.anonymousContexts.get(device.deviceId);
    if (existing) return existing;
    const pending = this.request<TokenResponse>(NETEASE_OPENAPI.anonymous,
      { clientId: this.appId }, { device, accessToken: '' }, 'POST').then((anonymous) => {
      if (!anonymous?.accessToken || anonymous.accessToken === 'null') {
        throw new BadGatewayException('网易云没有返回匿名授权令牌。');
      }
      return { device, accessToken: anonymous.accessToken };
    }).catch((error) => {
      if (this.anonymousContexts.get(device.deviceId) === pending) this.anonymousContexts.delete(device.deviceId);
      throw error;
    });
    if (this.anonymousContexts.size >= 200) {
      this.anonymousContexts.delete(this.anonymousContexts.keys().next().value!);
    }
    this.anonymousContexts.set(device.deviceId, pending);
    return pending;
  }

  async startQr(subject?: string) {
    const context = await this.anonymousContext(this.newDevice(subject));
    const data = await this.request<{ uniKey?: string; qrCodeUrl?: string }>(
      NETEASE_OPENAPI.qr, { type: 2, expiredKey: '300' }, context);
    if (!data?.uniKey || typeof data.qrCodeUrl !== 'string') {
      throw new BadGatewayException('网易云官方接口没有返回完整二维码。');
    }
    let url: URL;
    try { url = new URL(data.qrCodeUrl); } catch {
      throw new BadGatewayException('网易云返回的二维码链接无效。');
    }
    if (url.protocol !== 'https:') throw new BadGatewayException('网易云返回的二维码链接无效。');
    return { key: data.uniKey, url: url.href, context, expiresAt: Date.now() + QR_LIFETIME_MS };
  }

  h5Authorization(state: string, subject: string) {
    if (!this.appId || !this.privateKey) {
      throw new BadGatewayException('请先配置网易云开放平台 App ID 和 RSA 私钥。');
    }
    let callback: URL;
    try { callback = new URL(this.redirectUrl); } catch {
      throw new BadGatewayException('请配置 NETEASE_OPENAPI_REDIRECT_URL，并在网易云开放平台登记相同的公网回调地址。');
    }
    if (callback.protocol !== 'https:' || callback.username || callback.password || callback.search || callback.hash ||
        ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname)) {
      throw new BadGatewayException('网易云 H5 回调地址必须是无查询参数的公网 HTTPS 地址。');
    }
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(this.clientType)) {
      throw new BadGatewayException('请配置与网易云应用一致的 NETEASE_OPENAPI_CLIENT_TYPE。');
    }
    const url = new URL('https://music.163.com/st/platform/oauth/authorize');
    url.search = new URLSearchParams({ clientId: this.appId, state,
      clientType: this.clientType, redirectUrl: callback.href }).toString();
    return { url: url.href, context: { device: this.newDevice(subject), accessToken: '' } };
  }

  async exchangeCode(grantCode: string, context: OpenApiContext): Promise<OpenApiToken> {
    const data = await this.request<TokenResponse>(NETEASE_OPENAPI.exchange,
      { grantCode }, { device: context.device, accessToken: '' }, 'POST');
    return this.token(data);
  }

  poll(key: string, context: OpenApiContext) {
    return this.request<{ status?: number; accessToken?: TokenResponse; msg?: string }>(
      NETEASE_OPENAPI.poll, { key, clientId: this.appId }, context);
  }

  token(data: TokenResponse | undefined): OpenApiToken {
    const seconds = Number(data?.expireTime ?? data?.expiresTime ?? data?.expireIn);
    if (!data?.accessToken || data.accessToken === 'null' || !data.refreshToken ||
        data.refreshToken === 'null' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new BadGatewayException('网易云没有返回完整的官方授权令牌。');
    }
    return { accessToken: data.accessToken, refreshToken: data.refreshToken,
      expiresAt: Date.now() + seconds * 1000 };
  }

  async refresh(context: OpenApiContext, refreshToken: string): Promise<OpenApiToken> {
    const data = await this.request<TokenResponse>(NETEASE_OPENAPI.refresh,
      { clientId: this.appId, clientSecret: this.appKey, refreshToken }, context);
    return this.token(data);
  }

  async request<T>(
    endpoint: OpenApiEndpoint,
    business: Record<string, unknown>,
    context: OpenApiContext,
    method: 'GET' | 'POST' = 'GET',
  ): Promise<T> {
    if (!this.appId || !this.privateKey) {
      throw new BadGatewayException('请配置网易云开放平台 App ID 和 RSA 私钥。');
    }
    if (!Object.values(NETEASE_OPENAPI).includes(endpoint)) {
      throw new BadGatewayException('不支持的网易云官方接口。');
    }
    const params: Record<string, string> = {
      appId: this.appId, signType: 'RSA_SHA256', timestamp: String(Date.now()),
      device: JSON.stringify(context.device), bizContent: JSON.stringify(business),
      ...(context.accessToken ? { accessToken: context.accessToken } : {}),
    };
    const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
    try {
      this.signingKey ??= this.privateKey.includes('-----BEGIN')
        ? createPrivateKey(this.privateKey.replace(/\\n/g, '\n'))
        : createPrivateKey({ key: Buffer.from(this.privateKey.replace(/\s/g, ''), 'base64'),
          format: 'der', type: 'pkcs8' });
      params.sign = createSign('SHA256').update(canonical).sign(this.signingKey, 'base64');
    } catch {
      throw new BadGatewayException('网易云开放平台私钥无效，请检查 RSA 私钥配置。');
    }
    const url = new URL(endpoint, ORIGIN);
    if (method === 'GET') url.search = new URLSearchParams(params).toString();
    let body: { code?: number; data?: T };
    try {
      const response = await fetch(url, {
        method, headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(params) : undefined,
        redirect: 'error', signal: AbortSignal.timeout(8000), cache: 'no-store',
      });
      if (!response.ok) throw new Error('Unexpected HTTP status');
      body = await response.json() as typeof body;
    } catch {
      // Native fetch errors can contain the signed URL and its access token.
      throw new BadGatewayException('网易云官方接口连接失败或请求超时，请稍后重试。');
    }
    if (Number(body?.code) !== 200) {
      throw new NeteaseOpenApiError(Number.isFinite(Number(body?.code)) ? Number(body.code) : 0);
    }
    return body.data as T;
  }
}
