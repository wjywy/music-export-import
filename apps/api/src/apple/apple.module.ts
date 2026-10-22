import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlatformCredential } from '../common/entities/platform-credential.entity';
import { PlatformsModule } from '../platforms/platforms.module';
import { CredentialCipher } from '../platforms/credential-cipher.service';
import { PlaylistsModule } from '../playlists/playlists.module';
import { AppleController } from './apple.controller';
import { AppleMusicService } from './apple-music.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformCredential]),
    PlaylistsModule,
    PlatformsModule,
    AuthModule,
  ],
  controllers: [AppleController],
  providers: [AppleMusicService, CredentialCipher],
})
export class AppleModule {}
