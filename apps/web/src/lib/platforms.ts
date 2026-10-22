import type { Platform } from './types';

export const PLATFORM_ORDER: Platform[] = ['netease', 'qq', 'kugou', 'kuwo', 'apple'];

export const PLATFORM_INFO: Record<
  Platform,
  { name: string; short: string; monogram: string }
> = {
  netease: { name: '网易云音乐', short: '网易云', monogram: '网' },
  qq: { name: 'QQ 音乐', short: 'QQ', monogram: 'Q' },
  kugou: { name: '酷狗音乐', short: '酷狗', monogram: '酷' },
  kuwo: { name: '酷我音乐', short: '酷我', monogram: '我' },
  apple: { name: 'Apple Music', short: 'Apple', monogram: 'A' },
};

export function platformName(platform: Platform | null | undefined): string {
  return platform ? PLATFORM_INFO[platform].name : '手动创建';
}

export function platformShort(platform: Platform | null | undefined): string {
  return platform ? PLATFORM_INFO[platform].short : '渡口';
}

export function detectPlatform(url: string): Platform | null {
  const value = url.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('music.163.com') || value.includes('163cn.tv')) return 'netease';
  if (value.includes('y.qq.com') || value.includes('i.y.qq.com') || value.includes('qq.com')) return 'qq';
  if (value.includes('kugou.com')) return 'kugou';
  if (value.includes('kuwo.cn')) return 'kuwo';
  if (value.includes('music.apple.com')) return 'apple';
  return null;
}
