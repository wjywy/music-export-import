import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { mapLimit } from '../common/concurrency';
import { Playlist } from '../common/entities/playlist.entity';
import { PlaylistItem } from '../common/entities/playlist-item.entity';
import { TrackMatch } from '../common/entities/track-match.entity';
import { describeError, PlatformError } from '../common/platform-error';
import { Platform, PLATFORM_META } from '../common/platforms';
import { ParsedRef, RemotePlaylist } from '../platforms/adapter.interface';
import { MatchingService } from '../platforms/matching.service';
import { PlatformRegistry } from '../platforms/registry.service';
import {
  AddItemsDto,
  CreatePlaylistDto,
  CreatePlaylistItemDto,
  UpdatePlaylistDto,
} from './dto';

export type ExportFormat = 'csv' | 'txt' | 'json';

export interface PlaylistDetail {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  sourcePlatform: Platform | null;
  sourceUrl: string | null;
  visibility: string;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  matches: Partial<Record<Platform, number>>;
  items: {
    id: string;
    position: number;
    title: string;
    artist: string;
    album: string | null;
    durationMs: number | null;
    coverUrl: string | null;
    sourcePlatform: Platform | null;
    sourceUrl: string | null;
    matches: {
      platform: Platform;
      status: string;
      remoteTitle: string | null;
      remoteArtist: string | null;
      remoteAlbum: string | null;
      remoteUrl: string | null;
      score: number;
    }[];
  }[];
}

@Injectable()
export class PlaylistsService {
  constructor(
    @InjectRepository(Playlist)
    private readonly playlists: Repository<Playlist>,
    @InjectRepository(PlaylistItem)
    private readonly items: Repository<PlaylistItem>,
    @InjectRepository(TrackMatch)
    private readonly matches: Repository<TrackMatch>,
    private readonly registry: PlatformRegistry,
    private readonly matcher: MatchingService,
  ) {}

  async list(userId: string) {
    const rows = await this.playlists
      .createQueryBuilder('playlist')
      .loadRelationCountAndMap('playlist.itemCount', 'playlist.items')
      .where('playlist.ownerId = :userId', { userId })
      .orderBy('playlist.updatedAt', 'DESC')
      .getMany();

    return rows.map((playlist) => {
      const { items, ...rest } = playlist;
      void items;
      return rest as Playlist & { itemCount: number };
    });
  }

  async stats(userId: string) {
    const [playlistCount, trackCount, shareCount] = await Promise.all([
      this.playlists.count({ where: { ownerId: userId } }),
      this.items
        .createQueryBuilder('item')
        .innerJoin('item.playlist', 'playlist')
        .where('playlist.ownerId = :userId', { userId })
        .getCount(),
      this.matches
        .createQueryBuilder('match')
        .innerJoin('match.item', 'item')
        .innerJoin('item.playlist', 'playlist')
        .where('playlist.ownerId = :userId', { userId })
        .andWhere('match.status = :status', { status: 'matched' })
        .getCount(),
    ]);
    return { playlistCount, trackCount, matchCount: shareCount };
  }

  async getEntity(id: string, userId: string): Promise<Playlist> {
    const playlist = await this.playlists.findOne({ where: { id, ownerId: userId } });
    if (!playlist) throw new NotFoundException('没有找到这个歌单。');
    return playlist;
  }

  async getDetail(id: string, userId: string): Promise<PlaylistDetail> {
    const playlist = await this.playlists.findOne({
      where: { id, ownerId: userId },
      relations: { items: { matches: true } },
    });
    if (!playlist) throw new NotFoundException('没有找到这个歌单。');

    const items = [...(playlist.items ?? [])].sort((a, b) => a.position - b.position);
    const matches: Partial<Record<Platform, number>> = {};
    for (const item of items) {
      for (const match of item.matches ?? []) {
        if (match.status === 'matched') {
          matches[match.platform] = (matches[match.platform] ?? 0) + 1;
        }
      }
    }

    return {
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      coverUrl: playlist.coverUrl,
      sourcePlatform: playlist.sourcePlatform,
      sourceUrl: playlist.sourceUrl,
      visibility: playlist.visibility,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      itemCount: items.length,
      matches,
      items: items.map((item) => ({
        id: item.id,
        position: item.position,
        title: item.title,
        artist: item.artist,
        album: item.album,
        durationMs: item.durationMs,
        coverUrl: item.coverUrl,
        sourcePlatform: item.sourcePlatform,
        sourceUrl: item.sourceUrl,
        matches: [...(item.matches ?? [])]
          .sort((a, b) => a.platform.localeCompare(b.platform))
          .map((match) => ({
            platform: match.platform,
            status: match.status,
            remoteTitle: match.remoteTitle,
            remoteArtist: match.remoteArtist,
            remoteAlbum: match.remoteAlbum,
            remoteUrl: match.remoteUrl,
            score: match.score,
          })),
      })),
    };
  }

  async create(userId: string, dto: CreatePlaylistDto): Promise<Playlist> {
    const playlist = this.playlists.create({
      ownerId: userId,
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      visibility: dto.visibility ?? 'private',
    });
    const saved = await this.playlists.save(playlist);
    if (dto.items?.length) {
      await this.items.save(
        dto.items.map((item, index) => this.toItem(saved.id, item, index)),
      );
    }
    return saved;
  }

  async createFromRemote(
    userId: string,
    remote: RemotePlaylist,
    ref: ParsedRef,
  ): Promise<Playlist> {
    if (!remote.tracks.length) {
      throw new BadRequestException('这个歌单里没有曲目，无法导入。');
    }
    const playlist = await this.playlists.save(
      this.playlists.create({
        ownerId: userId,
        title: remote.name.slice(0, 200),
        description: remote.description?.slice(0, 2000) || null,
        coverUrl: remote.coverUrl?.slice(0, 800) || null,
        sourcePlatform: ref.platform,
        sourceUrl: ref.url,
        sourcePlaylistId: ref.id,
        visibility: 'private',
      }),
    );
    await this.items.save(
      remote.tracks.slice(0, 1000).map((track, index) =>
        this.items.create({
          playlistId: playlist.id,
          position: index,
          title: track.title.slice(0, 250),
          artist: (track.artist ?? '').slice(0, 250),
          album: track.album?.slice(0, 250) || null,
          durationMs: track.durationMs ?? null,
          coverUrl: track.coverUrl?.slice(0, 800) || null,
          sourcePlatform: ref.platform,
          sourceUrl: track.sourceUrl?.slice(0, 900) || null,
          isrc: track.isrc?.slice(0, 40) || null,
        }),
      ),
    );
    return playlist;
  }

  async update(id: string, userId: string, dto: UpdatePlaylistDto): Promise<PlaylistDetail> {
    const playlist = await this.getEntity(id, userId);
    if (dto.title !== undefined) playlist.title = dto.title.trim();
    if (dto.description !== undefined) playlist.description = dto.description?.trim() || null;
    if (dto.visibility !== undefined) playlist.visibility = dto.visibility;
    await this.playlists.save(playlist);
    return this.getDetail(id, userId);
  }

  async remove(id: string, userId: string): Promise<void> {
    const playlist = await this.getEntity(id, userId);
    await this.playlists.remove(playlist);
  }

  async addItems(id: string, userId: string, dto: AddItemsDto): Promise<PlaylistDetail> {
    await this.getEntity(id, userId);
    const last = await this.items.findOne({
      where: { playlistId: id },
      order: { position: 'DESC' },
    });
    const start = last ? last.position + 1 : 0;
    await this.items.save(
      dto.items.map((item, index) => this.toItem(id, item, start + index)),
    );
    return this.getDetail(id, userId);
  }

  async removeItem(id: string, userId: string, itemId: string): Promise<PlaylistDetail> {
    await this.getEntity(id, userId);
    const item = await this.items.findOne({ where: { id: itemId, playlistId: id } });
    if (!item) throw new NotFoundException('曲目不存在。');
    await this.items.remove(item);
    return this.getDetail(id, userId);
  }

  async duplicate(source: Playlist, userId: string, title?: string): Promise<Playlist> {
    const detail = await this.getDetailForOwner(source);
    const playlist = await this.playlists.save(
      this.playlists.create({
        ownerId: userId,
        title: (title ?? `${source.title}（来自分享）`).slice(0, 200),
        description: source.description,
        coverUrl: source.coverUrl,
        sourcePlatform: source.sourcePlatform,
        sourceUrl: source.sourceUrl,
        visibility: 'private',
      }),
    );
    if (detail.items.length) {
      await this.items.save(
        detail.items.map((item) =>
          this.items.create({
            playlistId: playlist.id,
            position: item.position,
            title: item.title,
            artist: item.artist,
            album: item.album,
            durationMs: item.durationMs,
            coverUrl: item.coverUrl,
            sourcePlatform: item.sourcePlatform,
            sourceUrl: item.sourceUrl,
            isrc: item.isrc,
          }),
        ),
      );
    }
    return playlist;
  }

  async match(
    id: string,
    userId: string,
    platform: Platform,
    threshold = 0.7,
  ): Promise<{ platform: Platform; total: number; matched: number; message: string }> {
    await this.getEntity(id, userId);
    await this.matcher.probe(platform);

    const items = await this.items.find({ where: { playlistId: id }, order: { position: 'ASC' } });
    if (!items.length) throw new BadRequestException('歌单里还没有曲目。');

    const outcomes = await mapLimit(items, 3, async (item) => {
      try {
        const result = await this.matcher.best(
          platform,
          { title: item.title, artist: item.artist, durationMs: item.durationMs },
          threshold,
        );
        return { item, result, error: null };
      } catch (error) {
        return { item, result: null, error };
      }
    });

    const failures = outcomes.filter((outcome) => outcome.error);
    if (failures.length === outcomes.length) {
      const first = failures[0]?.error;
      throw new PlatformError('UNAVAILABLE', describeError(first));
    }

    let matched = 0;
    for (const outcome of outcomes) {
      const result = outcome.result;
      const existing = await this.matches.findOne({
        where: { itemId: outcome.item.id, platform },
      });
      const record =
        existing ??
        this.matches.create({
          itemId: outcome.item.id,
          platform,
        });
      if (result?.hit) {
        record.status = 'matched';
        record.remoteTitle = result.hit.title.slice(0, 250);
        record.remoteArtist = (result.hit.artist ?? '').slice(0, 250);
        record.remoteAlbum = result.hit.album?.slice(0, 250) ?? null;
        record.remoteUrl = result.hit.sourceUrl?.slice(0, 900) ?? null;
        record.score = result.score;
        matched += 1;
      } else {
        record.status = 'missing';
        record.remoteTitle = result?.hit?.title?.slice(0, 250) ?? null;
        record.remoteArtist = result?.hit?.artist?.slice(0, 250) ?? null;
        record.remoteAlbum = null;
        record.remoteUrl = null;
        record.score = result?.score ?? 0;
      }
      await this.matches.save(record);
    }

    return {
      platform,
      total: items.length,
      matched,
      message:
        matched === items.length
          ? `${PLATFORM_META[platform].name}：${matched} 首全部匹配。`
          : `${PLATFORM_META[platform].name}：匹配 ${matched} / ${items.length} 首。`,
    };
  }

  async delivery(id: string, userId: string, platform: Platform) {
    const detail = await this.getDetail(id, userId);
    const rows = detail.items.map((item) => {
      const match = item.matches.find((entry) => entry.platform === platform);
      const query = `${item.title} ${item.artist}`.trim();
      return {
        itemId: item.id,
        title: item.title,
        artist: item.artist,
        status: match?.status === 'matched' ? 'ready' : 'search',
        remoteTitle: match?.remoteTitle ?? null,
        remoteArtist: match?.remoteArtist ?? null,
        url: match?.status === 'matched' ? match.remoteUrl : this.registry.searchUrl(platform, query),
        score: match?.score ?? 0,
      };
    });
    return {
      platform,
      platformName: PLATFORM_META[platform].name,
      total: rows.length,
      ready: rows.filter((row) => row.status === 'ready').length,
      rows,
    };
  }

  async export(
    id: string,
    userId: string,
    format: ExportFormat,
    platform?: Platform,
  ): Promise<{ filename: string; contentType: string; body: string }> {
    const detail = await this.getDetail(id, userId);
    const safeTitle = detail.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'playlist';

    if (format === 'json') {
      return {
        filename: `${safeTitle}.json`,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(
          {
            title: detail.title,
            description: detail.description,
            source: detail.sourcePlatform,
            sourceUrl: detail.sourceUrl,
            exportedAt: new Date().toISOString(),
            tracks: detail.items.map((item) => ({
              position: item.position + 1,
              title: item.title,
              artist: item.artist,
              album: item.album,
              durationMs: item.durationMs,
              sourceUrl: item.sourceUrl,
              match: item.matches.find((entry) => entry.platform === platform) ?? null,
            })),
          },
          null,
          2,
        ),
      };
    }

    if (format === 'txt') {
      const lines = detail.items.map((item) =>
        item.artist ? `${item.artist} - ${item.title}` : item.title,
      );
      return {
        filename: `${safeTitle}.txt`,
        contentType: 'text/plain; charset=utf-8',
        body: `\ufeff${lines.join('\n')}\n`,
      };
    }

    const header = [
      '序号',
      '曲名',
      '歌手',
      '专辑',
      '时长',
      '来源平台',
      '来源链接',
      '匹配平台',
      '匹配曲名',
      '匹配歌手',
      '匹配链接',
      '匹配度',
    ];
    const rows = detail.items.map((item) => {
      const match = item.matches.find((entry) => entry.platform === platform);
      return [
        String(item.position + 1),
        item.title,
        item.artist,
        item.album ?? '',
        item.durationMs ? formatDuration(item.durationMs) : '',
        item.sourcePlatform ? PLATFORM_META[item.sourcePlatform].name : '',
        item.sourceUrl ?? '',
        platform ? PLATFORM_META[platform].name : '',
        match?.remoteTitle ?? '',
        match?.remoteArtist ?? '',
        match?.remoteUrl ?? '',
        match?.status === 'matched' ? `${Math.round(match.score * 100)}%` : '',
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    return {
      filename: `${safeTitle}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: `\ufeff${csv}\r\n`,
    };
  }

  async getDetailForOwner(playlist: Playlist) {
    const items = await this.items.find({
      where: { playlistId: playlist.id },
      order: { position: 'ASC' },
    });
    return {
      items: items.map((item) => ({
        position: item.position,
        title: item.title,
        artist: item.artist,
        album: item.album,
        durationMs: item.durationMs,
        coverUrl: item.coverUrl,
        sourcePlatform: item.sourcePlatform,
        sourceUrl: item.sourceUrl,
        isrc: item.isrc,
      })),
    };
  }

  async publicDetail(playlist: Playlist) {
    const items = await this.items.find({
      where: { playlistId: playlist.id },
      order: { position: 'ASC' },
    });
    return {
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      coverUrl: playlist.coverUrl,
      sourcePlatform: playlist.sourcePlatform,
      sourceUrl: playlist.sourceUrl,
      visibility: playlist.visibility,
      createdAt: playlist.createdAt,
      itemCount: items.length,
      items: items.map((item) => ({
        id: item.id,
        position: item.position,
        title: item.title,
        artist: item.artist,
        album: item.album,
        durationMs: item.durationMs,
        sourcePlatform: item.sourcePlatform,
        sourceUrl: item.sourceUrl,
      })),
    };
  }

  async removeMatches(id: string, userId: string, platform?: Platform) {
    await this.getEntity(id, userId);
    const itemIds = (
      await this.items.find({ where: { playlistId: id }, select: { id: true } })
    ).map((item) => item.id);
    if (!itemIds.length) return { removed: 0 };
    const where = platform
      ? { itemId: In(itemIds), platform }
      : { itemId: In(itemIds) };
    const result = await this.matches.delete(where);
    return { removed: result.affected ?? 0 };
  }

  private toItem(playlistId: string, dto: CreatePlaylistItemDto, position: number) {
    return this.items.create({
      playlistId,
      position,
      title: dto.title.trim().slice(0, 250),
      artist: (dto.artist ?? '').trim().slice(0, 250),
      album: dto.album?.trim().slice(0, 250) || null,
      durationMs: dto.durationMs ?? null,
      sourcePlatform: dto.sourcePlatform ?? null,
      sourceUrl: dto.sourceUrl ?? null,
      isrc: dto.isrc ?? null,
    });
  }
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
