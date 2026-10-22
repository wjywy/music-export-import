import { BadRequestException, Injectable } from '@nestjs/common';
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

  startQr(platform: AccountPlatform): Promise<AccountQr> {
    if (platform === 'netease') return this.netease.startQr();
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

  async push(
    userId: string,
    playlistId: string,
    platform: AccountPlatform,
    name?: string,
  ): Promise<AccountPushResult> {
    if (platform !== 'netease' && platform !== 'qq') {
      throw new BadRequestException('目前只支持写入网易云音乐和 QQ 音乐。');
    }
    let detail = await this.playlists.getDetail(playlistId, userId);
    if (detail.items.length === 0) {
      throw new BadRequestException('这张歌单还没有曲目，无法写入。');
    }

    const usableMatchId = (value: string | null): boolean =>
      platform === 'netease'
        ? Boolean(value && /^\d+$/.test(value) && Number(value) > 0)
        : Boolean(value && value !== '0');
    const needsMatch = detail.items.some((item) => {
      const match = item.matches.find(
        (entry) => entry.platform === platform && entry.status === 'matched',
      );
      if (usableMatchId(match?.remoteId ?? null)) return false;
      if (item.sourcePlatform === platform) {
        const sourceId =
          platform === 'netease'
            ? neteaseIdFromUrl(item.sourceUrl)
            : qqMidFromUrl(item.sourceUrl);
        if (usableMatchId(sourceId)) return false;
      }
      return true;
    });
    if (needsMatch) {
      await this.playlists.match(playlistId, userId, platform);
      detail = await this.playlists.getDetail(playlistId, userId);
    }

    if (platform === 'netease') {
      return this.netease.push(userId, detail, name);
    }
    return this.qq.push(userId, detail, name);
  }
}
