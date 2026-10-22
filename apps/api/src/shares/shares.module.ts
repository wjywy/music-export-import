import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Share } from '../common/entities/share.entity';
import { PlaylistsModule } from '../playlists/playlists.module';
import { PublicSharesController } from './public-shares.controller';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  imports: [TypeOrmModule.forFeature([Share]), PlaylistsModule, AuthModule],
  controllers: [SharesController, PublicSharesController],
  providers: [SharesService],
  exports: [SharesService],
})
export class SharesModule {}
