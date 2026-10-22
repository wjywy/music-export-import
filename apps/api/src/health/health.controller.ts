import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlatformRegistry } from '../platforms/registry.service';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: PlatformRegistry,
  ) {}

  @Get()
  check() {
    return {
      ok: this.dataSource.isInitialized,
      driver: this.dataSource.options.type,
      time: new Date().toISOString(),
      platforms: this.registry.list().length,
    };
  }
}
