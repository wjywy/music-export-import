import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Playlist } from '../common/entities/playlist.entity';
import { PlaylistItem } from '../common/entities/playlist-item.entity';
import { TrackMatch } from '../common/entities/track-match.entity';
import { PlatformsModule } from '../platforms/platforms.module';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Playlist, PlaylistItem, TrackMatch]),
    PlatformsModule,
    AuthModule,
  ],
  controllers: [PlaylistsController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
