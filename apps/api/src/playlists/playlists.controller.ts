import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { isPlatform, Platform } from '../common/platforms';
import {
  AddItemsDto,
  AssignMatchDto,
  CreatePlaylistDto,
  MatchDto,
  MergePlaylistsDto,
  UpdatePlaylistDto,
} from './dto';
import { ExportFormat, PlaylistsService } from './playlists.service';
import {
  isTransferFormat,
  isTransferTarget,
  MAX_TRANSFER_CHUNK,
  MIN_TRANSFER_CHUNK,
  TransferTextFormat,
} from './transfer';

@Controller('playlists')
@UseGuards(JwtAuthGuard)
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.playlists.list(user.sub);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.playlists.stats(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlaylistDto) {
    return this.playlists.create(user.sub, dto);
  }

  @Post('merge')
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergePlaylistsDto) {
    return this.playlists.mergePlaylists(user.sub, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.playlists.getDetail(id, user.sub);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlists.update(id, user.sub, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.playlists.remove(id, user.sub);
    return { ok: true };
  }

  @Post(':id/items')
  addItems(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddItemsDto,
  ) {
    return this.playlists.addItems(id, user.sub, dto);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.playlists.removeItem(id, user.sub, itemId);
  }

  @Post(':id/dedupe')
  dedupe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.playlists.dedupePlaylist(id, user.sub);
  }

  @Post(':id/items/:itemId/match')
  assignMatch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: AssignMatchDto,
  ) {
    return this.playlists.assignMatch(id, user.sub, itemId, dto);
  }

  @Post(':id/match')
  match(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MatchDto,
  ) {
    return this.playlists.match(id, user.sub, dto.platform, dto.threshold ?? 0.7);
  }

  @Delete(':id/matches')
  async clearMatches(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('platform') platform?: string,
  ) {
    const target = platform && isPlatform(platform) ? platform : undefined;
    return this.playlists.removeMatches(id, user.sub, target);
  }

  @Get(':id/delivery')
  delivery(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('platform') platform: string,
  ) {
    if (!isPlatform(platform)) {
      throw new BadRequestException('请选择要送达的平台。');
    }
    return this.playlists.delivery(id, user.sub, platform);
  }

  @Get(':id/transfer')
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('target') target?: string,
    @Query('format') format?: string,
    @Query('chunk') chunk?: string,
  ) {
    if (!isTransferTarget(target)) {
      throw new BadRequestException('目标平台目前只支持 QQ 音乐和网易云音乐。');
    }

    let textFormat: TransferTextFormat = 'song-singer';
    if (format !== undefined) {
      if (!isTransferFormat(format)) {
        throw new BadRequestException(
          '文本格式只支持 song-singer、singer-song、song-only。',
        );
      }
      textFormat = format;
    }

    let chunkChars: number | undefined;
    if (chunk !== undefined) {
      const value = Number(chunk);
      if (
        !Number.isInteger(value) ||
        value < MIN_TRANSFER_CHUNK ||
        value > MAX_TRANSFER_CHUNK
      ) {
        throw new BadRequestException(
          `分段长度需在 ${MIN_TRANSFER_CHUNK}–${MAX_TRANSFER_CHUNK} 字符之间。`,
        );
      }
      chunkChars = value;
    }

    return this.playlists.transfer(id, user.sub, target, textFormat, chunkChars);
  }

  @Get(':id/export')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
    @Query('format') format = 'csv',
    @Query('platform') platform?: string,
  ) {
    const allowed: ExportFormat[] = ['csv', 'txt', 'json'];
    if (!allowed.includes(format as ExportFormat)) {
      throw new BadRequestException('导出格式只支持 csv、txt、json。');
    }
    const target: Platform | undefined =
      platform && isPlatform(platform) ? platform : undefined;
    const file = await this.playlists.export(
      id,
      user.sub,
      format as ExportFormat,
      target,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    return file.body;
  }
}
