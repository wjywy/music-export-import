import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'node:path';
import { AppleModule } from './apple/apple.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { PlatformsModule } from './platforms/platforms.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { SharesModule } from './shares/shares.module';
import { UsersModule } from './users/users.module';

export function databaseOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: config.get<string>('DB_HOST', '127.0.0.1'),
    port: Number(config.get<string>('DB_PORT', '3306')),
    username: config.get<string>('DB_USER', 'dukou'),
    password: config.get<string>('DB_PASSWORD', 'dukou'),
    database: config.get<string>('DB_NAME', 'dukou'),
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: false,
    migrationsRun: false,
    migrations: [join(__dirname, 'database/migrations/*{.ts,.js}')],
    migrationsTableName: 'migrations',
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
    AppleModule,
    HealthModule,
  ],
})
export class AppModule {}
