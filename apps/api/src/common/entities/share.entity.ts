import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Playlist } from './playlist.entity';
import { User } from './user.entity';

export type SharePermission = 'view' | 'clone';

@Entity('shares')
@Index(['playlistId'])
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 40 })
  token: string;

  @Column({ name: 'playlist_id', type: 'varchar', length: 36 })
  playlistId: string;

  @ManyToOne(() => Playlist, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlist_id' })
  playlist: Playlist;

  @Column({ name: 'creator_id', type: 'varchar', length: 36 })
  creatorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @Column({ type: 'simple-enum', enum: ['view', 'clone'], default: 'clone' })
  permission: SharePermission;

  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'view_count', type: 'int', default: 0 })
  viewCount: number;

  @Column({ name: 'clone_count', type: 'int', default: 0 })
  cloneCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
