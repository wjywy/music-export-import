import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { Playlist } from './common/entities/playlist.entity';
import { PlaylistItem } from './common/entities/playlist-item.entity';
import { Share } from './common/entities/share.entity';
import { User } from './common/entities/user.entity';
import { DEMO_PLAYLISTS } from './seed/demo-data';

const DEMO_EMAIL = 'demo@dukou.app';
const DEMO_PASSWORD = 'demo1234';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dataSource = app.get(DataSource);
  const users = dataSource.getRepository(User);
  const playlists = dataSource.getRepository(Playlist);
  const items = dataSource.getRepository(PlaylistItem);
  const shares = dataSource.getRepository(Share);

  let user = await users.findOne({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await users.save(
      users.create({
        email: DEMO_EMAIL,
        passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
        displayName: '渡口访客',
      }),
    );
    console.log(`已创建演示账号 ${DEMO_EMAIL}`);
  }

  const existing = await playlists.count({ where: { ownerId: user.id } });
  if (existing === 0) {
    for (const demo of DEMO_PLAYLISTS) {
      const playlist = await playlists.save(
        playlists.create({
          ownerId: user.id,
          title: demo.title,
          description: demo.description,
          sourcePlatform: demo.platform,
          sourceUrl: null,
          visibility: 'private',
        }),
      );
      await items.save(
        demo.tracks.map((track, index) =>
          items.create({
            playlistId: playlist.id,
            position: index,
            title: track.title,
            artist: track.artist,
            album: track.album ?? null,
            durationMs: track.durationMs,
            sourcePlatform: demo.platform,
            sourceUrl: null,
          }),
        ),
      );
      console.log(`已写入演示歌单《${demo.title}》(${demo.tracks.length} 首)`);
    }
  } else {
    console.log(`演示账号下已有 ${existing} 个歌单，跳过写入。`);
  }

  const first = await playlists.findOne({
    where: { ownerId: user.id },
    order: { createdAt: 'ASC' },
  });
  if (first) {
    const demoShare = await shares.findOne({ where: { token: 'demo' } });
    if (!demoShare) {
      await shares.save(
        shares.create({
          token: 'demo',
          playlistId: first.id,
          creatorId: user.id,
          permission: 'clone',
          expiresAt: null,
        }),
      );
      console.log('已创建演示分享链接 /s/demo');
    }
  }

  const total = await items
    .createQueryBuilder('item')
    .innerJoin('item.playlist', 'playlist')
    .where('playlist.ownerId = :id', { id: user.id })
    .getCount();

  console.log('');
  console.log('演示数据就绪：');
  console.log(`  邮箱：${DEMO_EMAIL}`);
  console.log(`  密码：${DEMO_PASSWORD}`);
  console.log(`  歌单：${await playlists.count({ where: { ownerId: user.id } })} 个 / 曲目：${total} 首`);
  console.log('  分享：http://localhost:5173/s/demo');
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
