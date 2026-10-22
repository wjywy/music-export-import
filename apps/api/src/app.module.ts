import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { PlatformsModule } from './platforms/platforms.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { SharesModule } from './shares/shares.module';
import { UsersModule } from './users/users.module';

function databaseOptions(config: ConfigService): TypeOrmModuleOptions {
  const driver = config.get<string>('DB_DRIVER', 'mysql');
  if (driver === 'sqljs') {
    const configured = config.get<string>('DB_SQLJS_PATH', 'data/dukou.sqlite');
    const location = isAbsolute(configured) ? configured : join(process.cwd(), configured);
    mkdirSync(dirname(location), { recursive: true });
    return {
      type: 'sqljs',
      location,
      autoSave: true,
      autoLoadEntities: true,
      synchronize: true,
      logging: false,
    };
  }

  if (driver !== 'mysql') {
    throw new Error(`DB_DRIVER 只支持 mysql 或 sqljs，收到：${driver}`);
  }

  const synchronize = config.get<string>('DB_SYNCHRONIZE', 'true') !== 'false';
  return {
    type: 'mysql',
    host: config.get<string>('DB_HOST', '127.0.0.1'),
    port: Number(config.get<string>('DB_PORT', '3306')),
    username: config.get<string>('DB_USER', 'dukou'),
    password: config.get<string>('DB_PASSWORD', 'dukou'),
    database: config.get<string>('DB_NAME', 'dukou'),
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize,
    autoLoadEntities: true,
    logging: false,
    extra: { connectionLimit: 10 },
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local', join(process.cwd(), '../../.env')],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: databaseOptions,
    }),
    UsersModule,
    AuthModule,
    PlatformsModule,
    PlaylistsModule,
    ImportsModule,
    SharesModule,
    HealthModule,
  ],
})
export class AppModule {}
