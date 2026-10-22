import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppleAdapter } from './adapters/apple.adapter';
import { KugouAdapter } from './adapters/kugou.adapter';
import { KuwoAdapter } from './adapters/kuwo.adapter';
import { NeteaseAdapter } from './adapters/netease.adapter';
import { QQAdapter } from './adapters/qq.adapter';
import { KuwoSessionService } from './kuwo-session.service';
import { MatchingService } from './matching.service';
import { PlatformsController } from './platforms.controller';
import { PlatformRegistry } from './registry.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformsController],
  providers: [
    NeteaseAdapter,
    QQAdapter,
    KugouAdapter,
    KuwoAdapter,
    AppleAdapter,
    PlatformRegistry,
    MatchingService,
    KuwoSessionService,
  ],
  exports: [PlatformRegistry, MatchingService, KuwoSessionService],
})
export class PlatformsModule {}
