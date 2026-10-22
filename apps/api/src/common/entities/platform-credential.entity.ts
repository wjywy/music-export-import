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

@Entity('platform_credentials')
@Index(['userId', 'platform'], { unique: true })
export class PlatformCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'simple-enum', enum: PLATFORMS })
  platform: Platform;

  @Column({ name: 'encrypted_token', type: 'text' })
  encryptedToken: string;

  @Column({ length: 8, default: 'cn' })
  storefront: string;

  @Column({ name: 'token_expires_at', type: 'datetime', nullable: true })
  tokenExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
