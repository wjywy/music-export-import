import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Platform, PLATFORMS, Visibility } from '../platforms';
import { User } from './user.entity';
import { PlaylistItem } from './playlist-item.entity';

@Entity('playlists')
@Index(['ownerId', 'createdAt'])
export class Playlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'cover_url', type: 'varchar', length: 800, nullable: true })
  coverUrl: string | null;

  @Column({
    name: 'source_platform',
    type: 'simple-enum',
    enum: PLATFORMS,
    nullable: true,
  })
  sourcePlatform: Platform | null;

  @Column({ name: 'source_url', type: 'varchar', length: 900, nullable: true })
  sourceUrl: string | null;

  @Column({ name: 'source_playlist_id', type: 'varchar', length: 120, nullable: true })
  sourcePlaylistId: string | null;

  @Column({
    type: 'simple-enum',
    enum: ['private', 'unlisted', 'public'],
    default: 'private',
  })
  visibility: Visibility;

  @OneToMany(() => PlaylistItem, (item) => item.playlist)
  items: PlaylistItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
