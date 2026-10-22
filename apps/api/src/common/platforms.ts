export const PLATFORMS = ['netease', 'qq', 'kugou', 'kuwo', 'apple'] as const;

export type Platform = (typeof PLATFORMS)[number];

export type Visibility = 'private' | 'unlisted' | 'public';

export interface PlatformMeta {
  platform: Platform;
  name: string;
  short: string;
  monogram: string;
  /** Read a public playlist by link. */
  read: boolean;
  /** Search the catalogue for cross-platform matching. */
  search: boolean;
  /** Push tracks into the user's account (not offered by public APIs yet). */
  write: boolean;
  auth: 'none' | 'cookie' | 'token';
  note: string;
}

export const PLATFORM_META: Record<Platform, PlatformMeta> = {
  netease: {
    platform: 'netease',
    name: '网易云音乐',
    short: '网易云',
    monogram: '网',
    read: true,
    search: true,
    write: false,
    auth: 'none',
    note: '公开歌单接口可直接读取；部分版权曲目受限。',
  },
  qq: {
    platform: 'qq',
    name: 'QQ 音乐',
    short: 'QQ',
    monogram: 'Q',
    read: true,
    search: true,
    write: false,
    auth: 'none',
    note: '公开接口读取歌单与搜索；部分私密歌单需要 QQ_COOKIE。',
  },
  kugou: {
    platform: 'kugou',
    name: '酷狗音乐',
    short: '酷狗',
    monogram: '酷',
    read: true,
    search: true,
    write: false,
    auth: 'none',
    note: '移动端公开接口，无需登录。',
  },
  kuwo: {
    platform: 'kuwo',
    name: '酷我音乐',
    short: '酷我',
    monogram: '我',
    read: true,
    search: true,
    write: false,
    auth: 'none',
    note: '公开网页与搜索接口可直接读取；可选 KUWO_COOKIE 用于登录态场景。',
  },
  apple: {
    platform: 'apple',
    name: 'Apple Music',
    short: 'Apple',
    monogram: 'A',
    read: true,
    search: true,
    write: true,
    auth: 'token',
    note: '读取需要开发者令牌；用户在设置里完成 MusicKit 授权后可写入资料库。',
  },
};

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

export function platformName(platform: Platform | null | undefined): string {
  return platform ? PLATFORM_META[platform].name : '手动创建';
}
