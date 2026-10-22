import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImportJob } from '../common/entities/import-job.entity';
import { dedupeTracks } from '../common/tracks';
import { describeError } from '../common/platform-error';
import { PLATFORM_META, Platform } from '../common/platforms';
import { ParsedRef, PlatformAdapter } from '../platforms/adapter.interface';
import { PlatformRegistry } from '../platforms/registry.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { NeteaseAccountService } from '../accounts/netease-account.service';
import { BatchImportDto, CreateImportDto } from './dto';

@Injectable()
export class ImportsService {
  constructor(
    @InjectRepository(ImportJob)
    private readonly jobs: Repository<ImportJob>,
    private readonly registry: PlatformRegistry,
    private readonly playlists: PlaylistsService,
    private readonly netease: NeteaseAccountService,
  ) {}

  async create(userId: string, dto: CreateImportDto) {
    const ref = await this.registry.resolve(dto.url);
    this.assertSupported(ref);
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

  async createBatch(userId: string, dto: BatchImportDto) {
    const refs: ParsedRef[] = [];
    for (const url of dto.urls) {
      const ref = await this.registry.resolve(url);
      this.assertSupported(ref);
      refs.push(ref);
    }

    const job = await this.jobs.save(
      this.jobs.create({
        userId,
        url: refs.map((ref) => ref.url).join(' ').slice(0, 900),
        platform: null,
        targetPlatform: dto.targetPlatform ?? null,
        kind: 'batch',
        urls: dto.urls,
        status: 'queued',
        progress: 2,
        message: `已识别 ${refs.length} 个链接，准备读取。`,
      }),
    );
    void this.runBatch(job.id, userId, refs, dto);
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

  private assertSupported(ref: ParsedRef): void {
    if (ref.platform !== 'netease' && ref.platform !== 'qq') {
      throw new BadRequestException(
        '目前只支持 QQ 音乐和网易云音乐之间的迁移。',
      );
    }
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
      const cookie =
        ref.platform === 'netease' ? await this.netease.cookieFor(userId) : null;
      const remote = await this.registry
        .get(ref.platform)
        .fetchPlaylist(ref, cookie ? { cookie } : undefined);
      const deduped = dedupeTracks(remote.tracks);
      remote.tracks = deduped.tracks;
      const total = remote.tracks.length;
      await update({
        progress: 42,
        total,
        duplicateCount: deduped.removed,
        resultTitle: dto.title ?? remote.name,
        message: `读取到 ${total} 首曲目${deduped.removed ? `，去除 ${deduped.removed} 首重复` : ''}。${remote.warning ? ` ${remote.warning}` : ''}`,
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

  private async runBatch(
    jobId: string,
    userId: string,
    refs: ParsedRef[],
    dto: BatchImportDto,
  ): Promise<void> {
    const update = (patch: Partial<ImportJob>) => this.jobs.update(jobId, patch);
    try {
      await update({ status: 'fetching', progress: 8, message: '正在逐张读取歌单…' });
      const remotes: { remote: Awaited<ReturnType<PlatformAdapter['fetchPlaylist']>>; ref: ParsedRef }[] = [];
      const failures: string[] = [];

      for (let index = 0; index < refs.length; index += 1) {
        const ref = refs[index];
        await update({
          progress: 8 + Math.round((index / refs.length) * 42),
          message: `正在读取第 ${index + 1} / ${refs.length} 张歌单…`,
        });
        try {
          const cookie =
            ref.platform === 'netease' ? await this.netease.cookieFor(userId) : null;
          const remote = await this.registry
            .get(ref.platform)
            .fetchPlaylist(ref, cookie ? { cookie } : undefined);
          remotes.push({ remote, ref });
        } catch (error) {
          failures.push(`${PLATFORM_META[ref.platform].name}：${describeError(error)}`);
        }
      }

      if (remotes.length === 0) {
        throw new Error(failures.join('；') || '没有读到任何歌单。');
      }

      const combined = remotes.flatMap((entry) =>
        entry.remote.tracks.map((track) => ({
          ...track,
          sourcePlatform: entry.ref.platform,
        })),
      );
      const deduped = dedupeTracks(combined);
      const platforms = new Set(remotes.map((entry) => entry.ref.platform));
      const title =
        dto.title?.trim() ||
        `${remotes[0].remote.name} 等 ${remotes.length} 张歌单`;

      await update({
        status: 'saving',
        progress: 58,
        total: deduped.tracks.length,
        duplicateCount: deduped.removed,
        resultTitle: title,
        message: `读取完成：${combined.length} 首，去除重复 ${deduped.removed} 首。`,
      });

      const playlist = await this.playlists.createFromTracks(
        userId,
        {
          title,
          description:
            dto.title?.trim() ||
            `合并自 ${remotes.length} 张歌单：${remotes.map((entry) => entry.remote.name).join('、')}`,
          coverUrl: remotes[0].remote.coverUrl,
          sourcePlatform: platforms.size === 1 ? remotes[0].ref.platform : null,
        },
        deduped.tracks,
      );

      await update({
        progress: 70,
        playlistId: playlist.id,
        message: `已合并《${title}》，共 ${deduped.tracks.length} 首。`,
      });

      let matched = 0;
      let matchNote = '';
      if (dto.targetPlatform) {
        await update({
          status: 'matching',
          progress: 78,
          message: `正在匹配到 ${PLATFORM_META[dto.targetPlatform].name}…`,
        });
        try {
          const result = await this.playlists.match(playlist.id, userId, dto.targetPlatform);
          matched = result.matched;
          matchNote = `，${PLATFORM_META[dto.targetPlatform].name}匹配 ${matched} / ${deduped.tracks.length} 首`;
        } catch (error) {
          matchNote = `；匹配失败：${describeError(error)}`;
        }
      }

      const failureNote = failures.length ? `；${failures.length} 张失败：${failures.join('；')}` : '';
      await update({
        status: 'succeeded',
        progress: 100,
        matched,
        message: `已合并 ${remotes.length} 张歌单，共 ${deduped.tracks.length} 首（去重 ${deduped.removed} 首）${matchNote}${failureNote}`,
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
      kind: job.kind,
      urls: job.urls,
      duplicateCount: job.duplicateCount,
      resultTitle: job.resultTitle,
      message: job.message,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
