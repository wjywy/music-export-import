import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { SearchPlatformDto } from '../playlists/dto';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KuwoSessionService } from './kuwo-session.service';
import { PlatformRegistry } from './registry.service';

class ResolveUrlDto {
  @IsString()
  @MaxLength(2000)
  url: string;
}

@Controller('platforms')
export class PlatformsController {
  constructor(
    private readonly registry: PlatformRegistry,
    private readonly kuwoSession: KuwoSessionService,
  ) {}

  @Get()
  list() {
    const credentials = this.registry.credentials();
    return {
      platforms: this.registry.list().map((meta) => ({
        ...meta,
        credential: {
          envVar: credentials[meta.platform].auth,
          configured: credentials[meta.platform].configured,
          required: meta.auth !== 'none',
        },
      })),
      handlesWrite: this.registry.list().some((meta) => meta.write),
      note: '公开接口提供读取与搜索；Apple Music 授权后可写入资料库，其余平台通过文件与匹配清单送达。',
      sessions: {
        kuwo: this.kuwoSession.status(),
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('search')
  async search(@Body() dto: SearchPlatformDto) {
    const adapter = this.registry.get(dto.platform);
    const hits = await adapter.search(dto.query, dto.limit ?? 10);
    return { platform: dto.platform, query: dto.query, hits };
  }

  @UseGuards(JwtAuthGuard)
  @Get('kuwo/session')
  async kuwoSessionStatus() {
    const status = this.kuwoSession.status();
    if (status.source === 'none') {
      return this.kuwoSession.refresh();
    }
    return status;
  }

  @UseGuards(JwtAuthGuard)
  @Post('kuwo/session/refresh')
  refreshKuwoSession() {
    return this.kuwoSession.refresh();
  }

  @UseGuards(JwtAuthGuard)
  @Post('resolve')
  async resolve(@CurrentUser() _user: AuthUser, @Body() dto: ResolveUrlDto) {
    const ref = await this.registry.resolve(dto.url);
    return {
      ...ref,
      name: this.registry.meta(ref.platform).name,
      meta: this.registry.meta(ref.platform),
    };
  }
}
