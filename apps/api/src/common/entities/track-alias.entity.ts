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

@Entity('track_aliases')
@Index(['userId', 'platform', 'titleKey', 'artistKey'], { unique: true })
export class TrackAlias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'simple-enum', enum: PLATFORMS })
  platform: Platform;

  @Column({ name: 'title_key', type: 'varchar', length: 250 })
  titleKey: string;

  @Column({ name: 'artist_key', type: 'varchar', length: 250 })
  artistKey: string;

  @Column({ name: 'remote_id', type: 'varchar', length: 120, nullable: true })
  remoteId: string | null;

  @Column({ name: 'remote_title', type: 'varchar', length: 250 })
  remoteTitle: string;

  @Column({ name: 'remote_artist', type: 'varchar', length: 250, default: '' })
  remoteArtist: string;

  @Column({ name: 'remote_url', type: 'varchar', length: 900, nullable: true })
  remoteUrl: string | null;

  @Column({ type: 'float', default: 1 })
  score: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
