import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountsService } from './accounts.service';
import { PushPlaylistDto } from './accounts.dto';
import { isAccountPlatform } from './account.types';

@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.accounts.status(user.sub);
  }

  @Post(':platform/qr')
  start(@Param('platform') platform: string) {
    if (!isAccountPlatform(platform)) {
      throw new BadRequestException('目前只支持网易云音乐和 QQ 音乐。');
    }
    return this.accounts.startQr(platform);
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
  ) {
    return this.accounts.push(user.sub, id, dto.platform, dto.name);
  }
}
