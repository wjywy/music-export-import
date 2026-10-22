import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Platform, PLATFORMS } from '../platforms';
import { User } from './user.entity';

export type ImportStatus = 'queued' | 'fetching' | 'saving' | 'matching' | 'succeeded' | 'failed';
export type ImportKind = 'single' | 'batch';

@Entity('import_jobs')
@Index(['userId', 'createdAt'])
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 900 })
  url: string;

  @Column({ type: 'simple-enum', enum: PLATFORMS, nullable: true })
  platform: Platform | null;

  @Column({ type: 'simple-enum', enum: ['queued', 'fetching', 'saving', 'matching', 'succeeded', 'failed'], default: 'queued' })
  status: ImportStatus;

  @Column({ name: 'target_platform', type: 'simple-enum', enum: PLATFORMS, nullable: true })
  targetPlatform: Platform | null;

  @Column({ type: 'simple-enum', enum: ['single', 'batch'], default: 'single' })
  kind: ImportKind;

  @Column({ type: 'simple-json', nullable: true })
  urls: string[] | null;

  @Column({ name: 'duplicate_count', type: 'int', default: 0 })
  duplicateCount: number;

  @Column({ name: 'result_title', type: 'varchar', length: 200, nullable: true })
  resultTitle: string | null;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  matched: number;

  @Column({ name: 'playlist_id', type: 'varchar', length: 36, nullable: true })
  playlistId: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
