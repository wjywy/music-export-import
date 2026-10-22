import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRegistry } from './registry.service';

class ResolveUrlDto {
  @IsString()
  @MaxLength(2000)
  url: string;
}

@Controller('platforms')
export class PlatformsController {
  constructor(private readonly registry: PlatformRegistry) {}

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
      handlesWrite: false,
      note: '公开接口只提供读取与搜索；导出会生成文件、匹配清单和平台搜索直达链接。',
    };
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
