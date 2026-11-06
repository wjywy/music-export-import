import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { ReportPushProgress } from '../common/push-progress';
import { PlatformError } from '../common/platform-error';
import { PlaylistsService } from '../playlists/playlists.service';
import {
  AccountPlatform,
  AccountPushResult,
  AccountQr,
  AccountQrStatus,
  AccountStatus,
} from './account.types';
import { NeteaseAccountService } from './netease-account.service';
import { QqAccountService } from './qq-account.service';
import { neteaseIdFromUrl, qqMidFromUrl } from './account.utils';

@Injectable()
export class AccountsService {
  private readonly inFlight = new Set<string>();
  constructor(
    private readonly netease: NeteaseAccountService,
    private readonly qq: QqAccountService,
    private readonly playlists: PlaylistsService,
  ) {}

  async status(userId: string): Promise<{ accounts: AccountStatus[] }> {
    const [netease, qq] = await Promise.all([
      this.netease.status(userId),
      this.qq.status(userId),
    ]);
    return { accounts: [netease, qq] };
  }

  startQr(platform: AccountPlatform, userId: string): Promise<AccountQr> {
    if (platform === 'netease') return this.netease.startQr(userId);
    return this.qq.startQr();
  }

  checkQr(
    userId: string,
    platform: AccountPlatform,
    key: string,
  ): Promise<AccountQrStatus> {
    if (platform === 'netease') return this.netease.checkQr(userId, key);
    return this.qq.checkQr(userId, key);
  }

  disconnect(userId: string, platform: AccountPlatform): Promise<{ ok: true }> {
    if (platform === 'netease') return this.netease.disconnect(userId);
    return this.qq.disconnect(userId);
  }

  async connectWithCookie(
    userId: string,
    platform: AccountPlatform,
    cookie: string,
  ): Promise<AccountStatus> {
    if (platform === 'netease') {
      return this.netease.connectWithCookie(userId, cookie);
    }
    throw new BadRequestException('QQ 音乐还不支持粘贴 Cookie，请用扫码登录。');
  }

  async push(
    userId: string,
    playlistId: string,
    platform: AccountPlatform,
    name?: string,
    report?: ReportPushProgress,
  ): Promise<AccountPushResult> {
    if (platform !== 'netease' && platform !== 'qq') {
      throw new BadRequestException('目前只支持写入网易云音乐和 QQ 音乐。');
    }
    const lock = `${userId}:${playlistId}:${platform}`;
    if (this.inFlight.has(lock)) throw new ConflictException('这张歌单正在写入，请等待当前迁移完成。');
    this.inFlight.add(lock);
    try {
      let detail = await this.playlists.getDetail(playlistId, userId);
      if (detail.items.length === 0) {
        throw new BadRequestException('这张歌单还没有曲目，无法写入。');
      }

      const usableMatchId = (value: string | null): boolean =>
        platform === 'netease'
          ? Boolean(value && /^\d+$/.test(value) && Number(value) > 0)
          : Boolean(value && value !== '0');
      const ready = (item: typeof detail.items[number]): boolean => {
        const match = item.matches.find(
          (entry) => entry.platform === platform && entry.status === 'matched',
        );
        if (usableMatchId(match?.remoteId ?? null)) return true;
        if (item.sourcePlatform === platform) {
          const sourceId =
            platform === 'netease'
              ? neteaseIdFromUrl(item.sourceUrl)
              : qqMidFromUrl(item.sourceUrl);
          if (usableMatchId(sourceId)) return true;
        }
        return false;
      };
      const pending = (item: typeof detail.items[number]): boolean => !ready(item) &&
        !item.matches.some((entry) => entry.platform === platform && entry.status === 'missing');
      const pendingItems = detail.items.filter(pending);
      if (pendingItems.length) {
        report?.('matching', 0, pendingItems.length);
        try {
          await this.playlists.match(playlistId, userId, platform, undefined, {
            itemIds: pendingItems.map((item) => item.id),
            onProgress: (completed, total) => report?.('matching', completed, total),
          });
        } catch (error) {
          if (!(error instanceof PlatformError) || !detail.items.some(ready)) throw error;
        }
        detail = await this.playlists.getDetail(playlistId, userId);
      }

      const result = platform === 'netease'
        ? await this.netease.push(userId, detail, name, report)
        : await this.qq.push(userId, detail, name, report);
      const pendingIds = new Set(pendingItems.map((item) => item.id));
      const retryable = detail.items.filter((item) => pendingIds.has(item.id) && pending(item)).length;
      if (retryable) result.warning = `${result.warning ?? ''}${retryable} 首曲目查询暂时失败，已跳过，可稍后重新匹配。`;
      return result;
    } finally {
      this.inFlight.delete(lock);
    }
  }
}
