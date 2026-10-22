import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Platform, PLATFORMS } from '../platforms';
import { Playlist } from './playlist.entity';
import { TrackMatch } from './track-match.entity';

@Entity('playlist_items')
@Index(['playlistId', 'position'])
export class PlaylistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'playlist_id', type: 'varchar', length: 36 })
  playlistId: string;

  @ManyToOne(() => Playlist, (playlist) => playlist.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'playlist_id' })
  playlist: Playlist;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ length: 250 })
  title: string;

  @Column({ length: 250, default: '' })
  artist: string;

  @Column({ type: 'varchar', length: 250, nullable: true })
  album: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

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

  @Column({ type: 'varchar', length: 40, nullable: true })
  isrc: string | null;

  @OneToMany(() => TrackMatch, (match) => match.item)
  matches: TrackMatch[];
}
