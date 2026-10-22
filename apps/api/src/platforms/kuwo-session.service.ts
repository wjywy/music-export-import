import { Injectable } from '@nestjs/common';

export type KuwoSessionSource = 'env' | 'auto' | 'none';

export interface KuwoSessionStatus {
  source: KuwoSessionSource;
  cookieNames: string[];
  refreshedAt: string | null;
  autoRefreshSeconds: number;
}

const COOKIE_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class KuwoSessionService {
  private cookie = '';
  private source: KuwoSessionSource = 'none';
  private refreshedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor() {
    const env = process.env.KUWO_COOKIE?.trim();
    if (env) {
      this.cookie = env;
      this.source = 'env';
      this.refreshedAt = Date.now();
    }
  }

  status(): KuwoSessionStatus {
    return {
      source: this.source,
      cookieNames: this.cookie
        .split(';')
        .map((part) => part.split('=')[0]?.trim())
        .filter(Boolean),
      refreshedAt: this.refreshedAt ? new Date(this.refreshedAt).toISOString() : null,
      autoRefreshSeconds: Math.round(COOKIE_TTL_MS / 1000),
    };
  }

  async cookieHeader(): Promise<Record<string, string>> {
    const env = process.env.KUWO_COOKIE?.trim();
    if (env) {
      const csrf = env.match(/kw_token=([^;]+)/)?.[1];
      return { cookie: env, ...(csrf ? { csrf } : {}) };
    }
    if (!this.cookie || Date.now() - this.refreshedAt > COOKIE_TTL_MS) {
      await this.refresh();
    }
    return this.cookie ? { cookie: this.cookie } : {};
  }

  async refresh(): Promise<KuwoSessionStatus> {
    if (process.env.KUWO_COOKIE?.trim()) {
      this.cookie = process.env.KUWO_COOKIE.trim();
      this.source = 'env';
      this.refreshedAt = Date.now();
      return this.status();
    }
    if (this.inflight) {
      await this.inflight;
      return this.status();
    }

    this.inflight = (async () => {
      try {
        const response = await fetch('https://www.kuwo.cn/', {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'zh-CN,zh;q=0.9',
          },
          signal: AbortSignal.timeout(10_000),
        });
        const rawCookies =
          typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : [];
        const cookies = rawCookies
          .map((entry) => entry.split(';')[0]?.trim())
          .filter((entry): entry is string => Boolean(entry && entry.includes('=')));
        if (cookies.length > 0) {
          this.cookie = cookies.join('; ');
          this.source = 'auto';
          this.refreshedAt = Date.now();
        } else if (!this.cookie) {
          this.source = 'none';
        }
      } catch {
        if (!this.cookie) this.source = 'none';
      }
    })();

    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
    return this.status();
  }
}
