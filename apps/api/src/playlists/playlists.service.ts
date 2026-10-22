import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { mapLimit } from '../common/concurrency';
import { dedupeTracks, trackKey } from '../common/tracks';
import { Playlist } from '../common/entities/playlist.entity';
import { PlaylistItem } from '../common/entities/playlist-item.entity';
import { TrackAlias } from '../common/entities/track-alias.entity';
import { TrackMatch } from '../common/entities/track-match.entity';
import { describeError, PlatformError } from '../common/platform-error';
import { Platform, PLATFORM_META } from '../common/platforms';
import { ParsedRef, RemotePlaylist } from '../platforms/adapter.interface';
import { MatchingService, normalize } from '../platforms/matching.service';
import { PlatformRegistry } from '../platforms/registry.service';
import {
  AddItemsDto,
  AssignMatchDto,
  CreatePlaylistDto,
  CreatePlaylistItemDto,
  MergePlaylistsDto,
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
      remoteId: string | null;
      source: string;
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
    @InjectRepository(TrackAlias)
    private readonly aliases: Repository<TrackAlias>,
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
            remoteId: match.remoteId,
            source: match.source,
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

  async createFromTracks(
    userId: string,
    meta: {
      title: string;
      description?: string | null;
      coverUrl?: string | null;
      sourcePlatform?: Platform | null;
      sourceUrl?: string | null;
      sourcePlaylistId?: string | null;
    },
    tracks: { title: string; artist?: string | null; album?: string | null; durationMs?: number | null; coverUrl?: string | null; sourceUrl?: string | null; sourcePlatform?: Platform | null; isrc?: string | null }[],
  ): Promise<Playlist> {
    const playlist = await this.playlists.save(
      this.playlists.create({
        ownerId: userId,
        title: meta.title.slice(0, 200),
        description: meta.description?.slice(0, 2000) || null,
        coverUrl: meta.coverUrl?.slice(0, 800) || null,
        sourcePlatform: meta.sourcePlatform ?? null,
        sourceUrl: meta.sourceUrl?.slice(0, 900) || null,
        sourcePlaylistId: meta.sourcePlaylistId ?? null,
        visibility: 'private',
      }),
    );

    await this.items.save(
      tracks.slice(0, 2000).map((track, index) =>
        this.items.create({
          playlistId: playlist.id,
          position: index,
          title: track.title.slice(0, 250),
          artist: (track.artist ?? '').slice(0, 250),
          album: track.album?.slice(0, 250) || null,
          durationMs: track.durationMs ?? null,
          coverUrl: track.coverUrl?.slice(0, 800) || null,
          sourcePlatform: track.sourcePlatform ?? meta.sourcePlatform ?? null,
          sourceUrl: track.sourceUrl?.slice(0, 900) || null,
          isrc: track.isrc?.slice(0, 40) || null,
        }),
      ),
    );
    return playlist;
  }

  async createFromRemote(
    userId: string,
    remote: RemotePlaylist,
    ref: ParsedRef,
  ): Promise<Playlist> {
    if (!remote.tracks.length) {
      throw new BadRequestException('这个歌单里没有曲目，无法导入。');
    }
    return this.createFromTracks(
      userId,
      {
        title: remote.name,
        description: remote.description,
        coverUrl: remote.coverUrl,
        sourcePlatform: ref.platform,
        sourceUrl: ref.url,
        sourcePlaylistId: ref.id,
      },
      remote.tracks.map((track) => ({ ...track, sourcePlatform: ref.platform })),
    );
  }

  async mergePlaylists(userId: string, dto: MergePlaylistsDto) {
    if (dto.playlistIds.length < 2 && !dto.title) {
      throw new BadRequestException('合并至少需要两张歌单，或给新歌单起个名字。');
    }
    const sources: Playlist[] = [];
    for (const playlistId of dto.playlistIds) {
      sources.push(await this.getEntity(playlistId, userId));
    }

    const combined: {
      title: string;
      artist: string;
      album: string | null;
      durationMs: number | null;
      coverUrl: string | null;
      sourcePlatform: Platform | null;
      sourceUrl: string | null;
      isrc: string | null;
    }[] = [];
    for (const source of sources) {
      const items = await this.items.find({
        where: { playlistId: source.id },
        order: { position: 'ASC' },
      });
      for (const item of items) {
        combined.push({
          title: item.title,
          artist: item.artist,
          album: item.album,
          durationMs: item.durationMs,
          coverUrl: item.coverUrl,
          sourcePlatform: item.sourcePlatform,
          sourceUrl: item.sourceUrl,
          isrc: item.isrc,
        });
      }
    }

    const deduped = dedupeTracks(combined);
    const platforms = new Set(sources.map((source) => source.sourcePlatform));
    const title =
      dto.title?.trim() ||
      `${sources[0].title} 等 ${sources.length} 张歌单`;

    const playlist = await this.createFromTracks(
      userId,
      {
        title,
        description:
          dto.description ??
          `合并自 ${sources.length} 张歌单：${sources.map((source) => source.title).join('、')}`,
        coverUrl: sources[0].coverUrl,
        sourcePlatform: platforms.size === 1 ? sources[0].sourcePlatform : null,
      },
      deduped.tracks,
    );

    return {
      playlist,
      total: deduped.tracks.length,
      duplicatesRemoved: deduped.removed,
    };
  }

  async dedupePlaylist(id: string, userId: string) {
    const playlist = await this.getEntity(id, userId);
    const items = await this.items.find({
      where: { playlistId: id },
      order: { position: 'ASC' },
    });
    const seen = new Set<string>();
    const keep: PlaylistItem[] = [];
    const drop: PlaylistItem[] = [];
    for (const item of items) {
      const key = trackKey(item);
      if (seen.has(key)) {
        drop.push(item);
      } else {
        seen.add(key);
        keep.push(item);
      }
    }

    if (drop.length > 0) {
      await this.items.remove(drop);
    }
    for (let index = 0; index < keep.length; index += 1) {
      if (keep[index].position !== index) {
        keep[index].position = index;
        await this.items.save(keep[index]);
      }
    }
    playlist.updatedAt = new Date();
    await this.playlists.save(playlist);

    return {
      removed: drop.length,
      itemCount: keep.length,
      detail: await this.getDetail(id, userId),
    };
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

    const existing = await this.matches.find({
      where: { platform, itemId: In(items.map((item) => item.id)) },
    });
    const existingByItem = new Map(existing.map((match) => [match.itemId, match]));

    const titleKeys = items.map((item) => normalize(item.title).slice(0, 250));
    const aliasRows = await this.aliases.find({
      where: { userId, platform, titleKey: In(titleKeys) },
    });
    const aliasByKey = new Map(
      aliasRows.map((alias) => [`${alias.titleKey}|${alias.artistKey}`, alias]),
    );

    const outcomes = await mapLimit(items, 3, async (item) => {
      const current = existingByItem.get(item.id);
      if (current?.source === 'manual') {
        return { item, current: current ?? null, alias: null, result: null, preserved: true, error: null };
      }
      const alias = aliasByKey.get(
        `${normalize(item.title).slice(0, 250)}|${normalize(item.artist).slice(0, 250)}`,
      );
      if (alias) {
        return { item, current: current ?? null, alias, result: null, preserved: false, error: null };
      }
      try {
        const result = await this.matcher.best(
          platform,
          { title: item.title, artist: item.artist, durationMs: item.durationMs },
          threshold,
        );
        return { item, current: current ?? null, alias: null, result, preserved: false, error: null };
      } catch (error) {
        return { item, current: current ?? null, alias: null, result: null, preserved: false, error };
      }
    });

    const failures = outcomes.filter((outcome) => outcome.error);
    const searched = outcomes.filter((outcome) => !outcome.preserved && !outcome.alias);
    if (searched.length > 0 && failures.length === searched.length) {
      const first = failures[0]?.error;
      throw new PlatformError('UNAVAILABLE', describeError(first));
    }

    let matched = 0;
    let reusedAliases = 0;
    for (const outcome of outcomes) {
      if (outcome.preserved) {
        matched += 1;
        continue;
      }

      const record =
        outcome.current ??
        this.matches.create({
          itemId: outcome.item.id,
          platform,
        });

      if (outcome.alias) {
        record.status = 'matched';
        record.remoteTitle = outcome.alias.remoteTitle.slice(0, 250);
        record.remoteArtist = outcome.alias.remoteArtist.slice(0, 250);
        record.remoteAlbum = null;
        record.remoteUrl = outcome.alias.remoteUrl?.slice(0, 900) ?? null;
        record.remoteId = outcome.alias.remoteId?.slice(0, 120) ?? null;
        record.score = outcome.alias.score;
        record.source = 'alias';
        matched += 1;
        reusedAliases += 1;
      } else if (outcome.result?.hit) {
        record.status = 'matched';
        record.remoteTitle = outcome.result.hit.title.slice(0, 250);
        record.remoteArtist = (outcome.result.hit.artist ?? '').slice(0, 250);
        record.remoteAlbum = outcome.result.hit.album?.slice(0, 250) ?? null;
        record.remoteUrl = outcome.result.hit.sourceUrl?.slice(0, 900) ?? null;
        record.remoteId = outcome.result.hit.sourceId?.slice(0, 120) ?? null;
        record.score = outcome.result.score;
        record.source = 'auto';
        matched += 1;
      } else {
        record.status = 'missing';
        record.remoteTitle = outcome.result?.hit?.title?.slice(0, 250) ?? null;
        record.remoteArtist = outcome.result?.hit?.artist?.slice(0, 250) ?? null;
        record.remoteAlbum = null;
        record.remoteUrl = null;
        record.remoteId = null;
        record.score = outcome.result?.score ?? 0;
        record.source = 'auto';
      }
      await this.matches.save(record);
    }

    const aliasNote = reusedAliases > 0 ? `，其中 ${reusedAliases} 首用了记住的映射` : '';
    return {
      platform,
      total: items.length,
      matched,
      message:
        matched === items.length
          ? `${PLATFORM_META[platform].name}：${matched} 首全部匹配${aliasNote}。`
          : `${PLATFORM_META[platform].name}：匹配 ${matched} / ${items.length} 首${aliasNote}。`,
    };
  }

  async assignMatch(
    playlistId: string,
    userId: string,
    itemId: string,
    dto: AssignMatchDto,
  ): Promise<{ matched: boolean; aliasSaved: boolean; remoteTitle: string }> {
    await this.getEntity(playlistId, userId);
    const item = await this.items.findOne({ where: { id: itemId, playlistId } });
    if (!item) throw new NotFoundException('曲目不存在。');

    const existing = await this.matches.findOne({
      where: { itemId, platform: dto.platform },
    });
    const record =
      existing ?? this.matches.create({ itemId, platform: dto.platform });
    record.status = 'matched';
    record.remoteTitle = dto.remoteTitle.slice(0, 250);
    record.remoteArtist = (dto.remoteArtist ?? '').slice(0, 250);
    record.remoteAlbum = dto.remoteAlbum?.slice(0, 250) ?? null;
    record.remoteUrl = dto.remoteUrl?.slice(0, 900) ?? null;
    record.remoteId = dto.remoteId?.slice(0, 120) ?? null;
    record.score = 1;
    record.source = 'manual';
    await this.matches.save(record);

    let aliasSaved = false;
    if (dto.remember !== false) {
      const titleKey = normalize(item.title).slice(0, 250);
      const artistKey = normalize(item.artist).slice(0, 250);
      if (titleKey) {
        const alias =
          (await this.aliases.findOne({
            where: { userId, platform: dto.platform, titleKey, artistKey },
          })) ?? this.aliases.create({ userId, platform: dto.platform, titleKey, artistKey });
        alias.remoteId = dto.remoteId?.slice(0, 120) ?? null;
        alias.remoteTitle = dto.remoteTitle.slice(0, 250);
        alias.remoteArtist = (dto.remoteArtist ?? '').slice(0, 250);
        alias.remoteUrl = dto.remoteUrl?.slice(0, 900) ?? null;
        alias.score = 1;
        await this.aliases.save(alias);
        aliasSaved = true;
      }
    }

    return { matched: true, aliasSaved, remoteTitle: record.remoteTitle ?? '' };
  }

  async listAliases(userId: string) {
    return this.aliases.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  async removeAlias(userId: string, id: string): Promise<{ ok: boolean }> {
    const alias = await this.aliases.findOne({ where: { id, userId } });
    if (!alias) throw new NotFoundException('没有找到这条映射。');
    await this.aliases.remove(alias);
    return { ok: true };
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
