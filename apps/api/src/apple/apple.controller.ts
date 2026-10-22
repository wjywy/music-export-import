import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppleMusicService } from './apple-music.service';
import { AppleAuthorizeDto } from './apple.dto';

@Controller('platforms/apple')
@UseGuards(JwtAuthGuard)
export class AppleController {
  constructor(private readonly apple: AppleMusicService) {}

  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.apple.config(user.sub);
  }

  @Post('authorize')
  authorize(@CurrentUser() user: AuthUser, @Body() dto: AppleAuthorizeDto) {
    return this.apple.authorize(user.sub, dto.musicUserToken, dto.storefront);
  }

  @Delete('authorize')
  disconnect(@CurrentUser() user: AuthUser) {
    return this.apple.disconnect(user.sub);
  }

  @Post('playlists/:id/push')
  push(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apple.pushPlaylist(user.sub, id);
  }
}
