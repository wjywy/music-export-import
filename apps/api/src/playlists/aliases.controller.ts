import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlaylistsService } from './playlists.service';

@Controller('aliases')
@UseGuards(JwtAuthGuard)
export class AliasesController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.playlists.listAliases(user.sub);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.playlists.removeAlias(user.sub, id);
  }
}
