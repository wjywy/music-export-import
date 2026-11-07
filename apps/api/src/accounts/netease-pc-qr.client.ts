import { BadGatewayException, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { cookieValue } from './account.utils';

// Reuse the installed SDK's codec; keep transport bounded and cookies session-local.
const { eapi } = require('NeteaseCloudMusicApi/util/crypto') as {
  eapi(path: string, data: Record<string, unknown>): Record<string, string>;
};
const ENDPOINTS = {
  key: '/api/login/qrcode/unikey',
  poll: '/api/login/qrcode/client/login',
} as const;
export type PcQrCookieJar = Map<string, string>;

@Injectable()
export class NeteasePcQrClient {
  mergeCookies(jar: PcQrCookieJar, raw: string[]) {
    for (const header of raw) {
      const pair = header.split(';', 1)[0].trim();
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (!value || /;\s*max-age=0(?:;|$)/i.test(header)) jar.delete(name);
      else jar.set(name, value);
    }
  }

  cookie(jar: PcQrCookieJar) {
    return [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  key(jar: PcQrCookieJar, signal: AbortSignal) {
    return this.call(ENDPOINTS.key, { type: 3 }, jar, signal);
  }

  poll(key: string, jar: PcQrCookieJar, signal: AbortSignal) {
    return this.call(ENDPOINTS.poll, { key, type: 3 }, jar, signal);
  }

  private async call(path: typeof ENDPOINTS[keyof typeof ENDPOINTS], data: Record<string, unknown>,
    jar: PcQrCookieJar, signal: AbortSignal): Promise<{ code?: number; unikey?: string; nickname?: string }> {
    const header = {
      os: 'pc', appver: '3.1.17.204416',
      osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', channel: 'netease',
      deviceId: jar.get('deviceId'), versioncode: '140', mobilename: '',
      buildver: String(Math.floor(Date.now() / 1000)), resolution: '1920x1080',
      __csrf: jar.get('__csrf') ?? '', requestId: `${Date.now()}_${randomInt(1000)}`,
      ...(jar.get('MUSIC_U') ? { MUSIC_U: jar.get('MUSIC_U') } : {}),
      ...(jar.get('MUSIC_A') ? { MUSIC_A: jar.get('MUSIC_A') } : {}),
    };
    try {
      const response = await fetch(`https://interface.music.163.com/eapi/${path.slice(5)}`, {
        method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        headers: { 'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.0.18.203152',
          cookie: this.cookie(new Map([...jar, ...Object.entries(header).filter((entry): entry is [string, string] => typeof entry[1] === 'string')])) },
        body: new URLSearchParams(eapi(path, { ...data, e_r: false, header })).toString(),
      });
      if (!response.ok) throw new Error('unexpected status');
      const body = await response.json() as { code?: number; unikey?: string; nickname?: string };
      // Only the HTTPS provider response may add authenticated cookies to this jar.
      this.mergeCookies(jar, response.headers.getSetCookie());
      if (!Number.isInteger(body.code)) throw new Error('invalid response');
      if (body.code === 803 && !cookieValue(this.cookie(jar), 'MUSIC_U')) {
        throw new BadGatewayException({ code: 'NETEASE_QR_REJECTED',
          message: '网易云已确认扫码，但没有返回登录会话，请重新生成二维码。' });
      }
      return body;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      // Fetch/codec failures can contain cookies or request bodies; do not echo them.
      throw new BadGatewayException('网易云扫码请求未完成，请稍后重试。');
    }
  }
}
