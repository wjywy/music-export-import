import { Module } from '@nestjs/common';
import { PlatformsModule } from '../platforms/platforms.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PlatformsModule],
  controllers: [HealthController],
})
export class HealthModule {}
