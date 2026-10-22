import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Playlist } from '../common/entities/playlist.entity';
import { PlaylistItem } from '../common/entities/playlist-item.entity';
import { TrackAlias } from '../common/entities/track-alias.entity';
import { TrackMatch } from '../common/entities/track-match.entity';
import { PlatformsModule } from '../platforms/platforms.module';
import { AliasesController } from './aliases.controller';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Playlist, PlaylistItem, TrackMatch, TrackAlias]),
    PlatformsModule,
    AuthModule,
  ],
  controllers: [PlaylistsController, AliasesController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
