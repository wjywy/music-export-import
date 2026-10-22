import 'reflect-metadata';
import { config } from 'dotenv';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ImportJob } from '../common/entities/import-job.entity';
import { PlaylistItem } from '../common/entities/playlist-item.entity';
import { PlatformCredential } from '../common/entities/platform-credential.entity';
import { Playlist } from '../common/entities/playlist.entity';
import { Share } from '../common/entities/share.entity';
import { TrackAlias } from '../common/entities/track-alias.entity';
import { TrackMatch } from '../common/entities/track-match.entity';
import { User } from '../common/entities/user.entity';

config({ path: ['.env', '.env.local', join(process.cwd(), '../../.env')] });

export const entities = [
  User,
  Playlist,
  PlaylistItem,
  TrackMatch,
  TrackAlias,
  PlatformCredential,
  Share,
  ImportJob,
];

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? '3306'),
  username: process.env.DB_USER ?? 'dukou',
  password: process.env.DB_PASSWORD ?? 'dukou',
  database: process.env.DB_NAME ?? 'dukou',
  charset: 'utf8mb4',
  timezone: 'Z',
  entities,
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: false,
};

export default new DataSource(dataSourceOptions);
