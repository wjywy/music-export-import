import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';

let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let token = '';
let secondToken = '';
let playlistId = '';
let shareToken = '';

function auth(value: string) {
  return { authorization: `Bearer ${value}` };
}

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, stopAtFirstError: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  http = app.getHttpServer();
});

after(async () => {
  await app.close();
});

test('health reports mysql', async () => {
  const res = await request(http).get('/api/health').expect(200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.driver, 'mysql');
});

test('rejects unauthenticated playlist access', async () => {
  await request(http).get('/api/playlists').expect(401);
});

test('registers two users', async () => {
  const stamp = Date.now();
  const first = await request(http)
    .post('/api/auth/register')
    .send({
      email: `e2e-${stamp}@dukou.app`,
      password: 'e2e-password-1',
      displayName: '测试甲',
    })
    .expect(201);
  token = first.body.token;

  const second = await request(http)
    .post('/api/auth/register')
    .send({
      email: `e2e-${stamp}-b@dukou.app`,
      password: 'e2e-password-2',
      displayName: '测试乙',
    })
    .expect(201);
  secondToken = second.body.token;
});

test('creates a playlist with duplicate tracks', async () => {
  const res = await request(http)
    .post('/api/playlists')
    .set(auth(token))
    .send({
      title: 'E2E 歌单',
      description: '自动化测试创建',
      items: [
        { title: '晴天', artist: '周杰伦' },
        { title: '晴天', artist: '周杰伦' },
        { title: '富士山下', artist: '陈奕迅' },
      ],
    })
    .expect(201);
  playlistId = res.body.id;

  const detail = await request(http)
    .get(`/api/playlists/${playlistId}`)
    .set(auth(token))
    .expect(200);
  assert.equal(detail.body.itemCount, 3);
  assert.equal(detail.body.items[0].title, '晴天');
});

test('dedupes a playlist', async () => {
  const res = await request(http)
    .post(`/api/playlists/${playlistId}/dedupe`)
    .set(auth(token))
    .expect(201);
  assert.equal(res.body.removed, 1);
  assert.equal(res.body.itemCount, 2);
});

test('exports CSV with a UTF-8 BOM and the track title', async () => {
  const res = await request(http)
    .get(`/api/playlists/${playlistId}/export?format=csv`)
    .set(auth(token))
    .expect(200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.ok(res.text.startsWith('\ufeff'));
  assert.ok(res.text.includes('晴天'));
});

test('shares a playlist and lets another user clone it', async () => {
  const share = await request(http)
    .post('/api/shares')
    .set(auth(token))
    .send({ playlistId, permission: 'clone', expiresInDays: 7 })
    .expect(201);
  shareToken = share.body.token;

  const publicView = await request(http).get(`/api/share/${shareToken}`).expect(200);
  assert.equal(publicView.body.playlist.title, 'E2E 歌单');
  assert.equal(publicView.body.playlist.itemCount, 2);

  const clone = await request(http)
    .post(`/api/share/${shareToken}/clone`)
    .set(auth(secondToken))
    .expect(201);
  assert.equal(clone.body.itemCount, 2);

  const secondList = await request(http)
    .get('/api/playlists')
    .set(auth(secondToken))
    .expect(200);
  assert.ok(secondList.body.some((entry: { title: string }) => entry.title.includes('来自分享')));
});

test('assigns a match manually and remembers the mapping', async () => {
  const detail = await request(http)
    .get(`/api/playlists/${playlistId}`)
    .set(auth(token))
    .expect(200);
  const itemId = detail.body.items[0].id;

  const assigned = await request(http)
    .post(`/api/playlists/${playlistId}/items/${itemId}/match`)
    .set(auth(token))
    .send({
      platform: 'qq',
      remoteId: 'e2e-manual-id',
      remoteTitle: '晴天（手动指定）',
      remoteArtist: '周杰伦',
      remoteUrl: 'https://y.qq.com/n/ryqq/songDetail/e2e-manual-id',
      remember: true,
    })
    .expect(201);
  assert.equal(assigned.body.matched, true);
  assert.equal(assigned.body.aliasSaved, true);

  const aliases = await request(http)
    .get('/api/aliases')
    .set(auth(token))
    .expect(200);
  assert.equal(aliases.body.length, 1);
  assert.equal(aliases.body[0].remoteTitle, '晴天（手动指定）');

  const afterAssign = await request(http)
    .get(`/api/playlists/${playlistId}`)
    .set(auth(token))
    .expect(200);
  const match = afterAssign.body.items[0].matches.find(
    (entry: { platform: string }) => entry.platform === 'qq',
  );
  assert.equal(match.source, 'manual');

  await request(http)
    .delete(`/api/aliases/${aliases.body[0].id}`)
    .set(auth(token))
    .expect(200);
});

test('builds a QQ text transfer plan from matched tracks', async () => {
  const res = await request(http)
    .get(`/api/playlists/${playlistId}/transfer?target=qq&format=song-singer&chunk=200`)
    .set(auth(token))
    .expect(200);

  assert.equal(res.body.target, 'qq');
  assert.equal(res.body.targetName, 'QQ 音乐');
  assert.equal(res.body.total, 2);
  assert.equal(res.body.matched, 1);
  assert.ok(res.body.text.includes('晴天（手动指定） - 周杰伦'));
  assert.ok(res.body.text.includes('富士山下 - 陈奕迅'));
  assert.ok(Array.isArray(res.body.chunks));
  assert.ok(res.body.chunks.length >= 1);
  assert.ok(res.body.steps.length >= 2);
  assert.match(res.body.importUrl, /y\.qq\.com/);
});

test('netease transfer reports the missing QQ link for a self-built playlist', async () => {
  const res = await request(http)
    .get(`/api/playlists/${playlistId}/transfer?target=netease`)
    .set(auth(token))
    .expect(200);

  assert.equal(res.body.target, 'netease');
  assert.equal(res.body.sourceLink, null);
  assert.match(res.body.note, /没有可用的 QQ 音乐原始链接/);
  assert.ok(res.body.steps.some((step: string) => step.includes('不能直接粘贴文字')));
});

test('rejects transfer of an empty playlist', async () => {
  const empty = await request(http)
    .post('/api/playlists')
    .set(auth(token))
    .send({ title: 'E2E 空歌单' })
    .expect(201);

  await request(http)
    .get(`/api/playlists/${empty.body.id}/transfer?target=qq`)
    .set(auth(token))
    .expect(400);
});

test('reports disconnected music accounts', async () => {
  const res = await request(http)
    .get('/api/accounts')
    .set(auth(token))
    .expect(200);
  assert.equal(res.body.accounts.length, 2);
  assert.ok(res.body.accounts.every((entry: { connected: boolean }) => entry.connected === false));
});

test('rejects an unsupported account platform', async () => {
  await request(http)
    .post('/api/accounts/spotify/qr')
    .set(auth(token))
    .expect(400);
});

test('rejects a push without a connected account', async () => {
  await request(http)
    .post(`/api/playlists/${playlistId}/push`)
    .set(auth(token))
    .send({ platform: 'netease' })
    .expect(401);
});

test('rejects an unsupported transfer target', async () => {
  await request(http)
    .get(`/api/playlists/${playlistId}/transfer?target=spotify`)
    .set(auth(token))
    .expect(400);
});

test('merges playlists and removes duplicates', async () => {
  const extra = await request(http)
    .post('/api/playlists')
    .set(auth(token))
    .send({
      title: 'E2E 第二张',
      items: [
        { title: '晴天', artist: '周杰伦' },
        { title: '平凡之路', artist: '朴树' },
      ],
    })
    .expect(201);

  const merged = await request(http)
    .post('/api/playlists/merge')
    .set(auth(token))
    .send({ playlistIds: [playlistId, extra.body.id], title: 'E2E 合并' })
    .expect(201);
  assert.equal(merged.body.total, 3);
  assert.equal(merged.body.duplicatesRemoved, 1);
  assert.equal(merged.body.playlist.title, 'E2E 合并');
});

test('rejects a batch import with an unsupported link', async () => {
  const res = await request(http)
    .post('/api/imports/batch')
    .set(auth(token))
    .send({ urls: ['not a playlist link'] })
    .expect(400);
  assert.match(res.body.message, /无法识别|没有识别/);
});

test('exposes Apple Music status without leaking a token when unconfigured', async () => {
  const res = await request(http)
    .get('/api/platforms/apple/config')
    .set(auth(token))
    .expect(200);
  assert.equal(typeof res.body.configured, 'boolean');
  assert.equal(typeof res.body.authorized, 'boolean');
  if (!res.body.configured) {
    assert.equal(res.body.developerToken, undefined);
  }
});

const appleConfigured = Boolean(
  process.env.APPLE_MUSIC_TOKEN?.trim() ||
    (process.env.APPLE_MUSIC_TEAM_ID?.trim() &&
      process.env.APPLE_MUSIC_KEY_ID?.trim() &&
      (process.env.APPLE_MUSIC_PRIVATE_KEY?.trim() ||
        process.env.APPLE_MUSIC_PRIVATE_KEY_PATH?.trim())),
);

test(
  'rejects Apple authorization when no developer token is configured',
  { skip: appleConfigured },
  async () => {
    const res = await request(http)
      .post('/api/platforms/apple/authorize')
      .set(auth(token))
      .send({ musicUserToken: 'x'.repeat(40) })
      .expect(400);
    assert.match(res.body.message, /未配置/);
  },
);

test(
  'rejects Apple push when no developer token is configured',
  { skip: appleConfigured },
  async () => {
    const res = await request(http)
      .post(`/api/platforms/apple/playlists/${playlistId}/push`)
      .set(auth(token))
      .expect(400);
    assert.match(res.body.message, /未配置/);
  },
);

test(
  'rejects Apple matching when no developer token is configured',
  { skip: appleConfigured },
  async () => {
    const res = await request(http)
      .post(`/api/playlists/${playlistId}/match`)
      .set(auth(token))
      .send({ platform: 'apple' })
      .expect(401);
    assert.match(res.body.message, /Apple Music|令牌/);
  },
);

test('rejects Soundiiz link generation for an unknown playlist', async () => {
  await request(http)
    .post(
      '/api/platforms/apple/playlists/00000000-0000-4000-8000-000000000000/soundiiz',
    )
    .set(auth(token))
    .expect(404);
});
