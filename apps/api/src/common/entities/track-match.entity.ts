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
import { PlaylistItem } from './playlist-item.entity';

export type MatchStatus = 'matched' | 'missing';
export type MatchSource = 'auto' | 'manual' | 'alias';

@Entity('track_matches')
@Index(['itemId', 'platform'], { unique: true })
export class TrackMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'item_id', type: 'varchar', length: 36 })
  itemId: string;

  @ManyToOne(() => PlaylistItem, (item) => item.matches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: PlaylistItem;

  @Column({ type: 'simple-enum', enum: PLATFORMS })
  platform: Platform;

  @Column({ type: 'simple-enum', enum: ['matched', 'missing'], default: 'missing' })
  status: MatchStatus;

  @Column({ name: 'remote_title', type: 'varchar', length: 250, nullable: true })
  remoteTitle: string | null;

  @Column({ name: 'remote_artist', type: 'varchar', length: 250, nullable: true })
  remoteArtist: string | null;

  @Column({ name: 'remote_album', type: 'varchar', length: 250, nullable: true })
  remoteAlbum: string | null;

  @Column({ name: 'remote_url', type: 'varchar', length: 900, nullable: true })
  remoteUrl: string | null;

  @Column({ name: 'remote_id', type: 'varchar', length: 120, nullable: true })
  remoteId: string | null;

  @Column({ type: 'simple-enum', enum: ['auto', 'manual', 'alias'], default: 'auto' })
  source: MatchSource;

  @Column({ type: 'float', default: 0 })
  score: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
