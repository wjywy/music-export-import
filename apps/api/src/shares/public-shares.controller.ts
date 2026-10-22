import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SharesService } from './shares.service';

@Controller('share')
export class PublicSharesController {
  constructor(private readonly shares: SharesService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.shares.publicView(token);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':token/clone')
  clone(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.shares.clone(token, user.sub);
  }

  @Get(':token/export')
  async export(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
    @Query('format') format = 'csv',
  ) {
    const allowed = ['csv', 'txt', 'json'] as const;
    const safe = allowed.includes(format as (typeof allowed)[number])
      ? (format as (typeof allowed)[number])
      : 'csv';
    const file = await this.shares.publicExport(token, safe);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    return file.body;
  }
}
