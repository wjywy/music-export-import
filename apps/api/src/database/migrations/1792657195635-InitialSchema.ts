import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1792657195635 implements MigrationInterface {
  name = 'InitialSchema1792657195635';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TABLE `users` (`id` varchar(36) NOT NULL, `email` varchar(190) NOT NULL, `password_hash` varchar(255) NOT NULL, `display_name` varchar(80) NOT NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_97672ac88f789774dd47f7c8be` (`email`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("CREATE TABLE `import_jobs` (`id` varchar(36) NOT NULL, `user_id` varchar(36) NOT NULL, `url` varchar(900) NOT NULL, `platform` enum ('netease', 'qq', 'kugou', 'kuwo', 'apple') NULL, `status` enum ('queued', 'fetching', 'saving', 'matching', 'succeeded', 'failed') NOT NULL DEFAULT 'queued', `target_platform` enum ('netease', 'qq', 'kugou', 'kuwo', 'apple') NULL, `progress` int NOT NULL DEFAULT '0', `total` int NOT NULL DEFAULT '0', `matched` int NOT NULL DEFAULT '0', `playlist_id` varchar(36) NULL, `message` text NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX `IDX_f71bd407180e2743f1d82ab997` (`user_id`, `created_at`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("CREATE TABLE `playlists` (`id` varchar(36) NOT NULL, `owner_id` varchar(36) NOT NULL, `title` varchar(200) NOT NULL, `description` text NULL, `cover_url` varchar(800) NULL, `source_platform` enum ('netease', 'qq', 'kugou', 'kuwo', 'apple') NULL, `source_url` varchar(900) NULL, `source_playlist_id` varchar(120) NULL, `visibility` enum ('private', 'unlisted', 'public') NOT NULL DEFAULT 'private', `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX `IDX_8c13e7cf05b56901666f0afbe2` (`owner_id`, `created_at`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("CREATE TABLE `track_matches` (`id` varchar(36) NOT NULL, `item_id` varchar(36) NOT NULL, `platform` enum ('netease', 'qq', 'kugou', 'kuwo', 'apple') NOT NULL, `status` enum ('matched', 'missing') NOT NULL DEFAULT 'missing', `remote_title` varchar(250) NULL, `remote_artist` varchar(250) NULL, `remote_album` varchar(250) NULL, `remote_url` varchar(900) NULL, `score` float NOT NULL DEFAULT '0', `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_2d591e0f16e03c2b90fe543117` (`item_id`, `platform`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("CREATE TABLE `playlist_items` (`id` varchar(36) NOT NULL, `playlist_id` varchar(36) NOT NULL, `position` int NOT NULL DEFAULT '0', `title` varchar(250) NOT NULL, `artist` varchar(250) NOT NULL DEFAULT '', `album` varchar(250) NULL, `duration_ms` int NULL, `cover_url` varchar(800) NULL, `source_platform` enum ('netease', 'qq', 'kugou', 'kuwo', 'apple') NULL, `source_url` varchar(900) NULL, `isrc` varchar(40) NULL, INDEX `IDX_716f3a38be60eaa5caaf487f3c` (`playlist_id`, `position`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("CREATE TABLE `shares` (`id` varchar(36) NOT NULL, `token` varchar(40) NOT NULL, `playlist_id` varchar(36) NOT NULL, `creator_id` varchar(36) NOT NULL, `permission` enum ('view', 'clone') NOT NULL DEFAULT 'clone', `expires_at` datetime NULL, `view_count` int NOT NULL DEFAULT '0', `clone_count` int NOT NULL DEFAULT '0', `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_f51f54e33eac0d4d7ada7422cf` (`token`), INDEX `IDX_6abff65d444aa93cfdb8ac5466` (`playlist_id`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("ALTER TABLE `import_jobs` ADD CONSTRAINT `FK_7d4484f0b66fc419287f6ca5452` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
    await queryRunner.query("ALTER TABLE `playlists` ADD CONSTRAINT `FK_891195fd52d0fe011ac038fc103` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
    await queryRunner.query("ALTER TABLE `track_matches` ADD CONSTRAINT `FK_f59aa11fe30cb9aa056e6228258` FOREIGN KEY (`item_id`) REFERENCES `playlist_items`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
    await queryRunner.query("ALTER TABLE `playlist_items` ADD CONSTRAINT `FK_1443ec83e270ecd8721a31cd319` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
    await queryRunner.query("ALTER TABLE `shares` ADD CONSTRAINT `FK_6abff65d444aa93cfdb8ac54665` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
    await queryRunner.query("ALTER TABLE `shares` ADD CONSTRAINT `FK_72be10899a8846e927b6093a513` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `shares` DROP FOREIGN KEY `FK_72be10899a8846e927b6093a513`");
    await queryRunner.query("ALTER TABLE `shares` DROP FOREIGN KEY `FK_6abff65d444aa93cfdb8ac54665`");
    await queryRunner.query("ALTER TABLE `playlist_items` DROP FOREIGN KEY `FK_1443ec83e270ecd8721a31cd319`");
    await queryRunner.query("ALTER TABLE `track_matches` DROP FOREIGN KEY `FK_f59aa11fe30cb9aa056e6228258`");
    await queryRunner.query("ALTER TABLE `playlists` DROP FOREIGN KEY `FK_891195fd52d0fe011ac038fc103`");
    await queryRunner.query("ALTER TABLE `import_jobs` DROP FOREIGN KEY `FK_7d4484f0b66fc419287f6ca5452`");
    await queryRunner.query("DROP INDEX `IDX_6abff65d444aa93cfdb8ac5466` ON `shares`");
    await queryRunner.query("DROP INDEX `IDX_f51f54e33eac0d4d7ada7422cf` ON `shares`");
    await queryRunner.query("DROP TABLE `shares`");
    await queryRunner.query("DROP INDEX `IDX_716f3a38be60eaa5caaf487f3c` ON `playlist_items`");
    await queryRunner.query("DROP TABLE `playlist_items`");
    await queryRunner.query("DROP INDEX `IDX_2d591e0f16e03c2b90fe543117` ON `track_matches`");
    await queryRunner.query("DROP TABLE `track_matches`");
    await queryRunner.query("DROP INDEX `IDX_8c13e7cf05b56901666f0afbe2` ON `playlists`");
    await queryRunner.query("DROP TABLE `playlists`");
    await queryRunner.query("DROP INDEX `IDX_f71bd407180e2743f1d82ab997` ON `import_jobs`");
    await queryRunner.query("DROP TABLE `import_jobs`");
    await queryRunner.query("DROP INDEX `IDX_97672ac88f789774dd47f7c8be` ON `users`");
    await queryRunner.query("DROP TABLE `users`");
  }
}
