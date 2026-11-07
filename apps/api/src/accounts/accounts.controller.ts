import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { respondToPush } from '../common/push-progress';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NeteaseOpenApiAccountService } from './netease-openapi-account.service';
import { AccountsService } from './accounts.service';
import { CompleteNeteaseOAuthDto, StartNeteaseOAuthDto, ConnectCookieDto, PushPlaylistDto } from './accounts.dto';
import { isAccountPlatform } from './account.types';

@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService,
    private readonly netease: NeteaseOpenApiAccountService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.accounts.status(user.sub);
  }

  @Post('netease/oauth/start')
  startOAuth(@CurrentUser() user: AuthUser, @Body() dto: StartNeteaseOAuthDto) {
    return this.netease.startOAuth(user.sub, dto.returnTo);
  }

  @Post('netease/oauth/complete')
  completeOAuth(@CurrentUser() user: AuthUser, @Body() dto: CompleteNeteaseOAuthDto) {
    return this.netease.completeOAuth(user.sub, dto.state, dto.code);
  }

  @Post(':platform/qr')
  start(@CurrentUser() user: AuthUser, @Param('platform') platform: string) {
    if (!isAccountPlatform(platform)) {
      throw new BadRequestException('目前只支持网易云音乐和 QQ 音乐。');
    }
    return this.accounts.startQr(platform, user.sub);
  }

  @Post(':platform/cookie')
  connectCookie(
    @CurrentUser() user: AuthUser,
    @Param('platform') platform: string,
    @Body() dto: ConnectCookieDto,
  ) {
    if (!isAccountPlatform(platform)) {
      throw new BadRequestException('目前只支持网易云音乐和 QQ 音乐。');
    }
    return this.accounts.connectWithCookie(user.sub, platform, dto.cookie);
  }

  @Get(':platform/qr/:key')
  check(
    @CurrentUser() user: AuthUser,
    @Param('platform') platform: string,
    @Param('key') key: string,
  ) {
    if (!isAccountPlatform(platform)) {
      throw new BadRequestException('目前只支持网易云音乐和 QQ 音乐。');
    }
    return this.accounts.checkQr(user.sub, platform, key);
  }

  @Delete(':platform')
  disconnect(
    @CurrentUser() user: AuthUser,
    @Param('platform') platform: string,
  ) {
    if (!isAccountPlatform(platform)) {
      throw new BadRequestException('目前只支持网易云音乐和 QQ 音乐。');
    }
    return this.accounts.disconnect(user.sub, platform);
  }
}

@Controller('playlists')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly accounts: AccountsService) {}

  @Post(':id/push')
  push(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PushPlaylistDto,
    @Headers('accept') accept: string | undefined,
    @Res() response: Response,
  ) {
    return respondToPush(response, accept, (report) => this.accounts.push(user.sub, id, dto.platform, dto.name, report));
  }
}
