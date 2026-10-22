import { MigrationInterface, QueryRunner } from 'typeorm';

export class MatchingAndCredentials1792657342708 implements MigrationInterface {
  name = 'MatchingAndCredentials1792657342708';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TABLE `platform_credentials` (`id` varchar(36) NOT NULL, `user_id` varchar(36) NOT NULL, `platform` enum ('netease', 'qq', 'kugou', 'kuwo', 'apple') NOT NULL, `encrypted_token` text NOT NULL, `storefront` varchar(8) NOT NULL DEFAULT 'cn', `token_expires_at` datetime NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_34d0aba2be6d39fc0c1a55fd49` (`user_id`, `platform`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("CREATE TABLE `track_aliases` (`id` varchar(36) NOT NULL, `user_id` varchar(36) NOT NULL, `platform` enum ('netease', 'qq', 'kugou', 'kuwo', 'apple') NOT NULL, `title_key` varchar(250) NOT NULL, `artist_key` varchar(250) NOT NULL, `remote_id` varchar(120) NULL, `remote_title` varchar(250) NOT NULL, `remote_artist` varchar(250) NOT NULL DEFAULT '', `remote_url` varchar(900) NULL, `score` float NOT NULL DEFAULT '1', `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX `IDX_bf17d23ec57868ed80c40263dd` (`user_id`, `platform`, `title_key`, `artist_key`), PRIMARY KEY (`id`)) ENGINE=InnoDB");
    await queryRunner.query("ALTER TABLE `import_jobs` ADD `kind` enum ('single', 'batch') NOT NULL DEFAULT 'single'");
    await queryRunner.query("ALTER TABLE `import_jobs` ADD `urls` text NULL");
    await queryRunner.query("ALTER TABLE `import_jobs` ADD `duplicate_count` int NOT NULL DEFAULT '0'");
    await queryRunner.query("ALTER TABLE `import_jobs` ADD `result_title` varchar(200) NULL");
    await queryRunner.query("ALTER TABLE `track_matches` ADD `remote_id` varchar(120) NULL");
    await queryRunner.query("ALTER TABLE `track_matches` ADD `source` enum ('auto', 'manual', 'alias') NOT NULL DEFAULT 'auto'");
    await queryRunner.query("ALTER TABLE `platform_credentials` ADD CONSTRAINT `FK_05266ba7e06158bcdf55f840f83` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
    await queryRunner.query("ALTER TABLE `track_aliases` ADD CONSTRAINT `FK_95c1d6ec5d52155174973a25623` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `track_aliases` DROP FOREIGN KEY `FK_95c1d6ec5d52155174973a25623`");
    await queryRunner.query("ALTER TABLE `platform_credentials` DROP FOREIGN KEY `FK_05266ba7e06158bcdf55f840f83`");
    await queryRunner.query("ALTER TABLE `track_matches` DROP COLUMN `source`");
    await queryRunner.query("ALTER TABLE `track_matches` DROP COLUMN `remote_id`");
    await queryRunner.query("ALTER TABLE `import_jobs` DROP COLUMN `result_title`");
    await queryRunner.query("ALTER TABLE `import_jobs` DROP COLUMN `duplicate_count`");
    await queryRunner.query("ALTER TABLE `import_jobs` DROP COLUMN `urls`");
    await queryRunner.query("ALTER TABLE `import_jobs` DROP COLUMN `kind`");
    await queryRunner.query("DROP INDEX `IDX_bf17d23ec57868ed80c40263dd` ON `track_aliases`");
    await queryRunner.query("DROP TABLE `track_aliases`");
    await queryRunner.query("DROP INDEX `IDX_34d0aba2be6d39fc0c1a55fd49` ON `platform_credentials`");
    await queryRunner.query("DROP TABLE `platform_credentials`");
  }
}
