import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccountsModule } from '../accounts/accounts.module';
import { ImportJob } from '../common/entities/import-job.entity';
import { PlatformsModule } from '../platforms/platforms.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJob]),
    PlatformsModule,
    PlaylistsModule,
    AuthModule,
    AccountsModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
