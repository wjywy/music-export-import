import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportJob } from '../common/entities/import-job.entity';
import { describeError } from '../common/platform-error';
import { PLATFORM_META, Platform } from '../common/platforms';
import { ParsedRef } from '../platforms/adapter.interface';
import { PlatformRegistry } from '../platforms/registry.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { CreateImportDto } from './dto';

@Injectable()
export class ImportsService {
  constructor(
    @InjectRepository(ImportJob)
    private readonly jobs: Repository<ImportJob>,
    private readonly registry: PlatformRegistry,
    private readonly playlists: PlaylistsService,
  ) {}

  async create(userId: string, dto: CreateImportDto) {
    const ref = await this.registry.resolve(dto.url);
    const job = await this.jobs.save(
      this.jobs.create({
        userId,
        url: dto.url.trim().slice(0, 900),
        platform: ref.platform,
        targetPlatform: dto.targetPlatform ?? null,
        status: 'queued',
        progress: 2,
        message: '已识别链接，正在准备读取。',
      }),
    );
    void this.run(job.id, userId, ref, dto);
    return this.serialize(job);
  }

  async list(userId: string) {
    const rows = await this.jobs.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return rows.map((job) => this.serialize(job));
  }

  async get(userId: string, id: string) {
    const job = await this.jobs.findOne({ where: { id, userId } });
    if (!job) throw new NotFoundException('没有找到这个导入任务。');
    return this.serialize(job);
  }

  private async run(
    jobId: string,
    userId: string,
    ref: ParsedRef,
    dto: CreateImportDto,
  ): Promise<void> {
    const update = (patch: Partial<ImportJob>) => this.jobs.update(jobId, patch);
    try {
      await update({
        status: 'fetching',
        progress: 10,
        message: `正在读取${PLATFORM_META[ref.platform].name}歌单…`,
      });
      const remote = await this.registry.get(ref.platform).fetchPlaylist(ref);
      const total = remote.tracks.length;
      await update({
        progress: 42,
        total,
        message: `读取到 ${total} 首曲目。${remote.warning ? ` ${remote.warning}` : ''}`,
      });

      if (dto.title) remote.name = dto.title;
      await update({ status: 'saving', progress: 55, message: '正在保存到你的歌单库…' });
      const playlist = await this.playlists.createFromRemote(userId, remote, ref);
      await update({
        progress: 66,
        playlistId: playlist.id,
        message: `已保存《${remote.name}》，共 ${total} 首。`,
      });

      let matched = 0;
      let matchNote = '';
      if (dto.targetPlatform) {
        await update({
          status: 'matching',
          progress: 74,
          message: `正在匹配到 ${PLATFORM_META[dto.targetPlatform].name}…`,
        });
        try {
          const result = await this.playlists.match(
            playlist.id,
            userId,
            dto.targetPlatform,
          );
          matched = result.matched;
          matchNote =
            matched === total
              ? `，${PLATFORM_META[dto.targetPlatform].name}全部匹配。`
              : `，${PLATFORM_META[dto.targetPlatform].name}匹配 ${matched} / ${total} 首。`;
        } catch (error) {
          matchNote = `；匹配到 ${PLATFORM_META[dto.targetPlatform].name} 失败：${describeError(error)}`;
        }
      }

      await update({
        status: 'succeeded',
        progress: 100,
        matched,
        message: `已导入 ${total} 首${matchNote}${remote.warning ? ` ${remote.warning}` : ''}`,
      });
    } catch (error) {
      await update({
        status: 'failed',
        progress: 100,
        message: describeError(error),
      });
    }
  }

  serialize(job: ImportJob) {
    return {
      id: job.id,
      url: job.url,
      platform: job.platform,
      platformName: job.platform ? PLATFORM_META[job.platform].name : null,
      targetPlatform: job.targetPlatform,
      targetPlatformName: job.targetPlatform
        ? PLATFORM_META[job.targetPlatform].name
        : null,
      status: job.status,
      progress: job.progress,
      total: job.total,
      matched: job.matched,
      playlistId: job.playlistId,
      message: job.message,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
