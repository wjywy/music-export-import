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
import { NeteaseQrPool } from './netease-qr-pool';
import { NeteasePcQrClient } from './netease-pc-qr.client';
import { NeteasePcQrService } from './netease-pc-qr.service';
import { NeteaseOpenApiClient } from './netease-openapi.client';
import { NeteaseOpenApiAccountService } from './netease-openapi-account.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformCredential]),
    PlatformsModule,
    PlaylistsModule,
    AuthModule,
  ],
  controllers: [AccountsController, PushController],
  providers: [
    AccountsService,
    NeteaseAccountService,
    QqAccountService,
    CredentialCipher,
    NeteasePcQrClient,
    NeteasePcQrService,
    NeteaseOpenApiClient,
    NeteaseOpenApiAccountService,
    { provide: NeteaseQrPool, useFactory: () => new NeteaseQrPool() },
  ],
  exports: [NeteaseAccountService],
})
export class AccountsModule {}
