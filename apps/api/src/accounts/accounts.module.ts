import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlatformCredential } from '../common/entities/platform-credential.entity';
import { PlatformsModule } from '../platforms/platforms.module';
import { CredentialCipher } from '../platforms/credential-cipher.service';
import { PlaylistsModule } from '../playlists/playlists.module';
import { AccountsController, PushController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { NeteaseAccountService } from './netease-account.service';
import { QqAccountService } from './qq-account.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformCredential]),
    PlatformsModule,
    PlaylistsModule,
    AuthModule,
  ],
  controllers: [AccountsController, PushController],
  providers: [AccountsService, NeteaseAccountService, QqAccountService, CredentialCipher],
  exports: [NeteaseAccountService],
})
export class AccountsModule {}
