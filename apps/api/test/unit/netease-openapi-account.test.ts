import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { NeteaseOpenApiAccountService } from '../../src/accounts/netease-openapi-account.service';
import { NETEASE_OPENAPI as API, NeteaseOpenApiClient } from '../../src/accounts/netease-openapi.client';
import { NeteaseAccountService } from '../../src/accounts/netease-account.service';
import { CredentialCipher } from '../../src/platforms/credential-cipher.service';
import type { PlatformCredential } from '../../src/common/entities/platform-credential.entity';
import type { PlaylistDetail } from '../../src/playlists/playlists.service';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ format: 'der', type: 'pkcs8' }).toString('base64');
const config = new ConfigService({ NETEASE_OPENAPI_APP_ID: 'unit-app',
  NETEASE_OPENAPI_PRIVATE_KEY: privateKey, NETEASE_OPENAPI_APP_KEY: 'unit-key', CREDENTIALS_SECRET: 'unit-cipher' });
const playlistId = 'b'.repeat(32), songId = 'a'.repeat(32);
const ref = { platform: 'netease' as const, kind: 'playlist' as const, id: '101', url: 'https://music.163.com/playlist?id=101' };
const publicPlaylist = { name: 'public', tracks: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(t: TestContext) {
  const rows = new Map<string, PlatformCredential>();
  const cipher = new CredentialCipher(config);
  let saves = 0, deletes = 0, qrCount = 0, state = 801;
  let accountId = 'unit-profile';
  const calls: Array<{ path: string; business: Record<string, unknown>; token: string }> = [];
  const defaultReply = (path: string): unknown => {
    switch (path) {
      case API.anonymous: return { accessToken: 'anonymous' };
      case API.qr: qrCount += 1; return { uniKey: `qr-${qrCount}`, qrCodeUrl: `https://163cn.tv/unit-${qrCount}` };
      case API.poll: return { status: state, accessToken: {
        accessToken: qrCount === 1 ? 'access' : `access-${qrCount}`,
        refreshToken: qrCount === 1 ? 'refresh' : `refresh-${qrCount}`, expireTime: 3600 } };
      case API.profile: return { id: accountId, nickname: 'unit' };
      case API.refresh: return { accessToken: 'renewed-access', refreshToken: 'renewed-refresh', expiresTime: 3600 };
      case API.created: return { records: [{ originalId: 101, id: playlistId, name: 'private', trackCount: 1 }], recordCount: 1 };
      case API.collected: return { records: [], recordCount: 0 };
      case API.playlist: return { id: playlistId, originalId: 101, name: 'private', trackCount: 1 };
      case API.tracks: return [{ id: songId, originalId: 1, name: 'song', duration: 180000,
        artists: [{ name: 'artist' }], album: { name: 'album' } }];
      case API.searchSongs: return { records: [{ id: 'd'.repeat(32), originalId: 99, name: 'song' },
        { id: songId, originalId: 1, name: 'song', visible: true }] };
      case API.create: return { id: playlistId, originalId: 101 };
      case API.add: return true;
      default: return {};
    }
  };
  let reply: ((path: string, business: Record<string, unknown>, token: string) => unknown | Promise<unknown>) | undefined;
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    const url = new URL(String(input));
    const params = options.method === 'POST' ? JSON.parse(options.body as string) : Object.fromEntries(url.searchParams);
    const business = JSON.parse(params.bizContent);
    const token = params.accessToken;
    calls.push({ path: url.pathname, business, token });
    const body = reply ? await reply(url.pathname, business, token) : defaultReply(url.pathname);
    if (body && typeof body === 'object' && 'code' in body) return Response.json(body);
    return Response.json({ code: 200, data: body });
  });
  const repository = {
    findOne: async ({ where }: { where: { userId: string } }) => rows.has(where.userId) ? { ...rows.get(where.userId)! } : null,
    create: (value: Partial<PlatformCredential>) => ({ ...value, createdAt: new Date() }),
    save: async (value: PlatformCredential) => { saves += 1; rows.set(value.userId, { ...value }); return value; },
    delete: async ({ userId }: { userId: string }) => { deletes += 1; rows.delete(userId); },
  };
  const client = new NeteaseOpenApiClient(config);
  const service = new NeteaseOpenApiAccountService(repository as never, cipher, client);
  t.after(() => service.onModuleDestroy());
  const read = (userId = 'owner') => JSON.parse(cipher.decrypt(rows.get(userId)!.encryptedToken));
  return { service, client, repository, cipher, rows, calls, defaultReply, read,
    saves: () => saves, deletes: () => deletes,
    state(value: number) { state = value; }, account(value: string) { accountId = value; },
    reply(value: typeof reply) { reply = value; },
    expire() { const value = read(); value.expiresAt = Date.now() - 1;
      rows.get('owner')!.encryptedToken = cipher.encrypt(JSON.stringify(value)); },
    async connect() { const qr = await service.startQr('owner'); state = 803;
      assert.equal((await service.checkQr('owner', qr.key)).status, 'authorized'); return qr; },
  };
}

test('official facade uses no browser; codes and encrypted tokens remain scoped to their owner', async (t) => {
  const f = fixture(t);
  const facade = new NeteaseAccountService(f.repository as never, f.cipher,
    { prepare() { throw new Error('browser must not start'); } } as never, f.service);
  assert.equal((await facade.status('owner')).connected, false);
  const [first, same, other] = await Promise.all([facade.startQr('owner'), facade.startQr('owner'), facade.startQr('other')]);
  assert.equal(first.key, same.key);
  assert.notEqual(first.key, other.key);
  assert.match(first.image, /^data:image\/png;base64,/);
  assert.equal((await facade.checkQr('other', first.key)).status, 'expired');
  assert.equal(f.calls.filter((call) => call.path === API.poll).length, 0);
  assert.equal((await facade.checkQr('owner', first.key)).status, 'waiting');
  f.state(802); assert.equal((await facade.checkQr('owner', first.key)).status, 'scanned');
  f.state(803);
  assert.deepEqual(await facade.checkQr('owner', first.key), { status: 'authorized', nickname: 'unit' });
  assert.match(f.rows.get('owner')!.encryptedToken, /^v1\./);
  assert.ok(!f.rows.get('owner')!.encryptedToken.includes('refresh'));
  assert.equal(f.read().kind, 'openapi');
  assert.equal(f.read().accountId, 'unit-profile');
  assert.equal((await facade.status('owner')).connected, true);
  assert.equal((await facade.status('other')).connected, false);
  assert.equal(await facade.cookieFor('owner'), null);
});

test('concurrent authorization polls validate and save only once', async (t) => {
  const f = fixture(t);
  const qr = await f.service.startQr('owner'); f.state(803);
  const results = await Promise.all([f.service.checkQr('owner', qr.key), f.service.checkQr('owner', qr.key)]);
  assert.deepEqual(results.map((result) => result.status), ['authorized', 'authorized']);
  assert.equal(f.saves(), 1);
  assert.equal(f.calls.filter((call) => call.path === API.profile).length, 1);
});

test('failed profile validation retains the owned code for a retry', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('owner'); f.state(803);
  f.reply((path) => path === API.profile ? { code: 500, message: 'upstream failure' } : f.defaultReply(path));
  await assert.rejects(() => f.service.checkQr('owner', qr.key), /500/);
  assert.equal(f.rows.size, 0);
  f.reply(undefined);
  assert.equal((await f.service.checkQr('owner', qr.key)).status, 'authorized');
});

test('disconnect cancels late validation, waits for it and prevents reconnecting', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('owner'); f.state(803);
  const validation = deferred<unknown>(), started = deferred<void>();
  f.reply((path) => { if (path === API.profile) { started.resolve(); return validation.promise; }
    return f.defaultReply(path); });
  const authorization = f.service.checkQr('owner', qr.key); await started.promise;
  const disconnect = f.service.disconnect('owner');
  assert.equal(f.service.disconnect('owner'), disconnect);
  assert.equal((await f.service.checkQr('owner', qr.key)).status, 'expired');
  validation.resolve({ id: 'profile', nickname: 'unit' });
  assert.equal((await authorization).status, 'expired'); await disconnect;
  assert.equal(f.rows.size, 0); assert.equal(f.deletes(), 1);
});

test('disconnect also cancels an in-flight QR initialization', async (t) => {
  const f = fixture(t); const response = deferred<unknown>(), started = deferred<void>();
  f.reply((path) => { if (path === API.qr) { started.resolve(); return response.promise; }
    return f.defaultReply(path); });
  const creating = f.service.startQr('owner');
  const rejected = assert.rejects(creating, /关闭/);
  await started.promise;
  const disconnect = f.service.disconnect('owner');
  response.resolve({ uniKey: 'late', qrCodeUrl: 'https://163cn.tv/late' });
  await rejected; await disconnect;
  assert.equal((await f.service.checkQr('owner', 'late')).status, 'expired');
});

test('expired codes cannot be reused or polled upstream', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('owner');
  qr.expiresAt = new Date(Date.now() - 1);
  assert.equal((await f.service.checkQr('owner', qr.key)).status, 'expired');
  assert.equal(f.calls.filter((call) => call.path === API.poll).length, 0);
  assert.notEqual((await f.service.startQr('owner')).key, qr.key);
});

test('expired tokens refresh once for concurrent imports and preserve their device context', async (t) => {
  const f = fixture(t); await f.connect(); f.expire();
  const before = f.read();
  const results = await Promise.all([f.service.fetchPlaylist('owner', ref, async () => publicPlaylist),
    f.service.fetchPlaylist('owner', ref, async () => publicPlaylist)]);
  assert.equal(results[0].tracks[0].sourceId, '1');
  assert.equal(f.calls.filter((call) => call.path === API.refresh).length, 1);
  assert.equal(f.read().accessToken, 'renewed-access');
  assert.deepEqual(f.read().device, before.device);
  assert.ok(f.calls.filter((call) => call.path === API.created).every((call) => call.token === 'renewed-access'));
});

test('a delayed 1406 uses the already refreshed token instead of refreshing an old snapshot again', async (t) => {
  const f = fixture(t); await f.connect();
  const delayed = deferred<unknown>(), secondStarted = deferred<void>();
  let staleCalls = 0;
  f.reply((path, _business, token) => {
    if (path === API.created && token === 'access') {
      staleCalls += 1;
      if (staleCalls === 2) { secondStarted.resolve(); return delayed.promise; }
      return { code: 1406 };
    }
    return f.defaultReply(path);
  });
  const first = f.service.fetchPlaylist('owner', ref, async () => publicPlaylist);
  const second = f.service.fetchPlaylist('owner', ref, async () => publicPlaylist);
  await secondStarted.promise; await first;
  delayed.resolve({ code: 1406 }); await second;
  assert.equal(f.calls.filter((call) => call.path === API.refresh).length, 1);
});

test('a late refresh cannot overwrite a newly authorized NetEase account', async (t) => {
  const f = fixture(t); await f.connect(); f.expire();
  const refreshing = deferred<unknown>(), started = deferred<void>();
  f.reply((path) => { if (path === API.refresh) { started.resolve(); return refreshing.promise; }
    return f.defaultReply(path); });
  const reading = f.service.fetchPlaylist('owner', ref, async () => publicPlaylist);
  const rejected = assert.rejects(reading, /连接已更新/);
  await started.promise;
  f.account('another-account');
  const qr = await f.service.startQr('owner');
  await f.service.checkQr('owner', qr.key);
  refreshing.resolve(f.defaultReply(API.refresh)); await rejected;
  assert.equal(f.read().accountId, 'another-account');
  assert.equal(f.read().accessToken, 'access-2');
});

test('official imports paginate all songs and retain original IDs for sharing and matching', async (t) => {
  const f = fixture(t); await f.connect();
  f.reply((path, business) => {
    if (path === API.playlist) return { id: playlistId, name: 'private', trackCount: 501 };
    if (path === API.tracks) {
      const offset = Number(business.offset);
      return Array.from({ length: offset ? 1 : 500 }, (_, i) =>
        ({ originalId: offset + i + 1, id: songId, name: 'song', duration: 180000, artists: [{ name: 'artist' }] }));
    }
    return f.defaultReply(path);
  });
  const result = await f.service.fetchPlaylist('owner', ref, async () => { throw new Error('private playlist must use OAuth'); });
  assert.equal(result.tracks.length, 501);
  assert.equal(result.tracks[500].sourceUrl, 'https://music.163.com/#/song?id=501');
  assert.equal(result.tracks[0].durationMs, 180000);
  assert.equal(result.warning, undefined);
});

test('official writes resolve exact original IDs and send encrypted IDs to the add endpoint', async (t) => {
  const f = fixture(t); await f.connect();
  const detail = { title: 'test', items: [{ title: 'song', artist: 'artist', sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/song?id=1', matches: [] }] } as unknown as PlaylistDetail;
  const result = await f.service.push('owner', detail);
  const addition = f.calls.find((call) => call.path === API.add)!;
  assert.deepEqual(addition.business, { playlistId, songIdList: [songId] });
  assert.equal(result.url, 'https://music.163.com/#/playlist?id=101');
  assert.equal(result.added, 1); assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
});

test('an unknown create response never falls back to adding to an existing playlist', async (t) => {
  const f = fixture(t); await f.connect();
  f.reply((path) => path === API.create ? {} : f.defaultReply(path));
  const detail = { title: 'test', items: [{ title: 'song', artist: 'artist', sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/song?id=1', matches: [] }] } as unknown as PlaylistDetail;
  await assert.rejects(() => f.service.push('owner', detail), /歌单标识/);
  assert.equal(f.calls.filter((call) => call.path === API.add).length, 0);
});
