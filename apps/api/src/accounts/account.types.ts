import { Platform } from '../common/platforms';

export type AccountPlatform = Extract<Platform, 'netease' | 'qq'>;
export const ACCOUNT_PLATFORMS: AccountPlatform[] = ['netease', 'qq'];

export function isAccountPlatform(value: unknown): value is AccountPlatform {
  return value === 'netease' || value === 'qq';
}

export interface AccountStatus {
  platform: AccountPlatform;
  connected: boolean;
  nickname: string | null;
  connectedAt: Date | null;
}

export interface AccountQr {
  platform: AccountPlatform;
  key: string;
  image: string;
  url?: string | null;
  expiresAt: Date;
}

export type AccountQrState = 'waiting' | 'scanned' | 'authorized' | 'expired';

export interface AccountQrStatus {
  status: AccountQrState;
  nickname?: string | null;
  message?: string | null;
}

export interface AccountPushResult {
  platform: AccountPlatform;
  playlistId: string;
  name: string;
  url: string;
  added: number;
  skipped: number;
  failed: number;
}
