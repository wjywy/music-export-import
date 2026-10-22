import { BadGatewayException, Injectable } from '@nestjs/common';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const TOKEN_TTL_SECONDS = 3600;
const MAX_TOKEN_TTL_SECONDS = 15_777_000;

export interface DeveloperTokenOptions {
  teamId: string;
  keyId: string;
  privateKey: string;
  now?: number;
  ttlSeconds?: number;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as unknown;
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Build the ES256 JWT Apple expects as the MusicKit developer token.
 * Kept as a pure function so the signature/claims can be tested without env.
 */
export function createDeveloperToken(options: DeveloperTokenOptions): string {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(
    Math.max(options.ttlSeconds ?? TOKEN_TTL_SECONDS, 60),
    MAX_TOKEN_TTL_SECONDS,
  );
  const header = {
    alg: 'ES256',
    kid: options.keyId,
    typ: 'JWT',
  };
  const payload = {
    iss: options.teamId,
    iat: now,
    exp: now + ttl,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload),
  )}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey({ key: options.privateKey, format: 'pem' }),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64Url(signature)}`;
}

@Injectable()
export class AppleTokenService {
  private cached: { token: string; expiresAt: number } | null = null;

  isConfigured(): boolean {
    return Boolean(this.staticToken()) || Boolean(this.keyConfig());
  }

  /**
   * Static APPLE_MUSIC_TOKEN wins so an operator can rotate without the p8 key.
   * Otherwise a short-lived token is minted from the MusicKit private key.
   */
  developerToken(): string | null {
    const staticToken = this.staticToken();
    if (staticToken) return staticToken;

    if (!this.keyConfig()) return null;

    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.expiresAt > now + 60) {
      return this.cached.token;
    }

    const config = this.keyConfig();
    if (!config) return null;
    const privateKey = this.privateKeyValue();
    if (!privateKey) return null;
    const token = (() => {
      try {
        return createDeveloperToken({
          teamId: config.teamId,
          keyId: config.keyId,
          privateKey,
        });
      } catch {
        throw new BadGatewayException(
          'Apple Music 私钥格式不正确，应为 Apple 下载的 .p8 文件内容。',
        );
      }
    })();
    this.cached = { token, expiresAt: now + TOKEN_TTL_SECONDS };
    return token;
  }

  configuredNote(): string | null {
    if (this.developerToken()) return null;
    const raw = process.env.APPLE_MUSIC_TOKEN?.trim();
    if (raw) {
      return 'APPLE_MUSIC_TOKEN 已过期或格式不正确，请重新生成，或改用自动签发。';
    }
    return '未配置 Apple Music 开发者令牌：请设置 APPLE_MUSIC_TOKEN，或配置 Team ID / Key ID / 私钥自动签发。';
  }

  private staticToken(): string | null {
    const raw = process.env.APPLE_MUSIC_TOKEN?.trim();
    if (!raw) return null;
    const payload = decodeJwtPayload(raw);
    if (!payload) return null;
    if (payload.exp && Number(payload.exp) * 1000 <= Date.now()) {
      return null;
    }
    return raw;
  }

  private keyConfig(): { teamId: string; keyId: string } | null {
    const teamId = process.env.APPLE_MUSIC_TEAM_ID?.trim();
    const keyId = process.env.APPLE_MUSIC_KEY_ID?.trim();
    if (!teamId || !keyId) return null;
    if (!this.privateKeyValue()) return null;
    return { teamId, keyId };
  }

  private privateKeyValue(): string | null {
    const inline = process.env.APPLE_MUSIC_PRIVATE_KEY?.trim();
    if (inline) return inline.replace(/\\n/g, '\n');
    const path = process.env.APPLE_MUSIC_PRIVATE_KEY_PATH?.trim();
    if (!path) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
}
