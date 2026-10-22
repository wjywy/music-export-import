import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { Share } from '../common/entities/share.entity';
import { PlaylistsService } from '../playlists/playlists.service';
import { CreateShareDto } from './dto';

@Injectable()
export class SharesService {
  constructor(
    @InjectRepository(Share)
    private readonly shares: Repository<Share>,
    private readonly playlists: PlaylistsService,
  ) {}

  async create(userId: string, dto: CreateShareDto) {
    const playlist = await this.playlists.getEntity(dto.playlistId, userId);
    const share = this.shares.create({
      playlistId: playlist.id,
      creatorId: userId,
      token: await this.uniqueToken(),
      permission: dto.permission ?? 'clone',
      expiresAt:
        dto.expiresInDays && dto.expiresInDays > 0
          ? new Date(Date.now() + dto.expiresInDays * 86_400_000)
          : null,
    });
    const saved = await this.shares.save(share);
    return this.serialize(saved, playlist.title);
  }

  async listMine(userId: string) {
    const rows = await this.shares.find({
      where: { creatorId: userId },
      relations: { playlist: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((share) => this.serialize(share, share.playlist?.title ?? ''));
  }

  async revoke(userId: string, id: string) {
    const share = await this.shares.findOne({ where: { id, creatorId: userId } });
    if (!share) throw new NotFoundException('分享不存在或已被取消。');
    await this.shares.remove(share);
    return { ok: true };
  }

  async publicView(token: string) {
    const share = await this.loadPublic(token);
    await this.shares.increment({ id: share.id }, 'viewCount', 1);
    const playlist = await this.playlists.publicDetail(share.playlist);
    return {
      token: share.token,
      permission: share.permission,
      expiresAt: share.expiresAt,
      viewCount: share.viewCount + 1,
      cloneCount: share.cloneCount,
      createdAt: share.createdAt,
      ownerName: share.creator?.displayName ?? '一位朋友',
      playlist,
    };
  }

  async clone(token: string, userId: string) {
    const share = await this.loadPublic(token);
    if (share.permission !== 'clone') {
      throw new ForbiddenException('这个分享只允许查看，不能保存到自己的歌单。');
    }
    if (share.creatorId === userId) {
      throw new ForbiddenException('这是你自己的歌单。');
    }
    const copy = await this.playlists.duplicate(
      share.playlist,
      userId,
      `${share.playlist.title}（来自分享）`,
    );
    await this.shares.increment({ id: share.id }, 'cloneCount', 1);
    const detail = await this.playlists.getDetail(copy.id, userId);
    return {
      playlistId: copy.id,
      title: copy.title,
      itemCount: detail.itemCount,
    };
  }

  async publicExport(token: string, format: 'csv' | 'txt' | 'json') {
    const share = await this.loadPublic(token);
    return this.playlists.export(share.playlist.id, share.playlist.ownerId, format);
  }

  private async loadPublic(token: string): Promise<Share> {
    const share = await this.shares.findOne({
      where: { token },
      relations: { playlist: { owner: true }, creator: true },
    });
    if (!share) throw new NotFoundException('这个分享链接不存在，或已被取消。');
    if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('这个分享链接已过期。');
    }
    return share;
  }

  private async uniqueToken(): Promise<string> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = randomBytes(9).toString('base64url');
      const exists = await this.shares.exist({ where: { token } });
      if (!exists) return token;
    }
    return randomBytes(12).toString('base64url');
  }

  private serialize(share: Share, playlistTitle: string) {
    return {
      id: share.id,
      token: share.token,
      playlistId: share.playlistId,
      playlistTitle,
      permission: share.permission,
      expiresAt: share.expiresAt,
      viewCount: share.viewCount,
      cloneCount: share.cloneCount,
      createdAt: share.createdAt,
    };
  }
}
