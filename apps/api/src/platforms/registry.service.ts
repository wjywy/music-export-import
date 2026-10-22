import { Injectable } from '@nestjs/common';
import { Platform, PLATFORM_META, PlatformMeta, PLATFORMS } from '../common/platforms';
import { PlatformError } from '../common/platform-error';
import { ParsedRef, PlatformAdapter } from './adapter.interface';
import { NeteaseAdapter } from './adapters/netease.adapter';
import { QQAdapter } from './adapters/qq.adapter';
import { KugouAdapter } from './adapters/kugou.adapter';
import { KuwoAdapter } from './adapters/kuwo.adapter';
import { AppleAdapter } from './adapters/apple.adapter';
import { resolveRedirect } from './http';

const SHORT_LINK_HOSTS = ['163cn.tv', 'url.cn', 'c6.y.qq.com', 't1.kugou.com'];

function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  const withProtocol = trimmed.match(/https?:\/\/[^\s，。；、）)】"'<>]+/i);
  if (withProtocol) return withProtocol[0].replace(/[.,;]+$/, '');
  const bare = trimmed.match(
    /(?:^|\s)((?:[a-z0-9-]+\.)+(?:com|cn|tv|net|io|me)(?::\d+)?(?:\/[^\s，。；、）)】"']*)?)/i,
  );
  return bare ? `https://${bare[1]}` : null;
}

@Injectable()
export class PlatformRegistry {
  private readonly adapters: Record<Platform, PlatformAdapter>;

  constructor(
    netease: NeteaseAdapter,
    qq: QQAdapter,
    kugou: KugouAdapter,
    kuwo: KuwoAdapter,
    apple: AppleAdapter,
  ) {
    this.adapters = {
      netease,
      qq,
      kugou,
      kuwo,
      apple,
    };
  }

  list(): PlatformMeta[] {
    return (['netease', 'qq'] as Platform[]).map(
      (platform) => this.adapters[platform].meta,
    );
  }

  get(platform: Platform): PlatformAdapter {
    const adapter = this.adapters[platform];
    if (!adapter) {
      throw new PlatformError('UNSUPPORTED_LINK', '暂不支持这个平台。');
    }
    return adapter;
  }

  parse(text: string): ParsedRef | null {
    const url = extractUrl(text);
    if (!url) return null;
    for (const platform of PLATFORMS) {
      const ref = this.adapters[platform].parse(url);
      if (ref) return ref;
    }
    return null;
  }

  async resolve(text: string): Promise<ParsedRef> {
    const url = extractUrl(text);
    if (!url) {
      throw new PlatformError(
        'UNSUPPORTED_LINK',
        '没有识别到链接。请粘贴完整歌单地址，例如 https://music.163.com/playlist?id=123456。',
      );
    }
    const direct = this.parse(url);
    if (direct) return direct;

    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      // fall through to the friendly error below
    }
    if (SHORT_LINK_HOSTS.some((short) => host === short || host.endsWith(`.${short}`))) {
      try {
        const resolved = await resolveRedirect(url);
        const ref = this.parse(resolved);
        if (ref) return ref;
      } catch {
        // fall through
      }
    }
    throw new PlatformError(
      'UNSUPPORTED_LINK',
      `无法识别 ${host || '这个'} 的链接。目前支持网易云、QQ 音乐、酷狗、酷我、Apple Music 的公开歌单地址。`,
    );
  }

  searchUrl(platform: Platform, query: string): string {
    return this.adapters[platform].searchUrl(query);
  }

  credentials(): Record<Platform, { configured: boolean; auth: string }> {
    const has = (value?: string) => Boolean(value?.trim());
    return {
      netease: { configured: true, auth: '公开接口' },
      qq: { configured: true, auth: 'QQ_COOKIE（可选）' },
      kugou: { configured: true, auth: '公开接口' },
      kuwo: { configured: true, auth: 'KUWO_COOKIE（可选）' },
      apple: { configured: has(process.env.APPLE_MUSIC_TOKEN), auth: 'APPLE_MUSIC_TOKEN' },
    };
  }

  meta(platform: Platform): PlatformMeta {
    return PLATFORM_META[platform];
  }
}
