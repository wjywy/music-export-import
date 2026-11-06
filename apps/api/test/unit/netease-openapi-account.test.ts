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
const config = new ConfigService({ NETEASE_QR_PROVIDER: 'openapi', NETEASE_OPENAPI_APP_ID: 'unit-app',
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

test('profile retry never polls an already consumed single-use QR again', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('owner'); f.state(803);
  f.reply((path) => path === API.profile ? { code: 500, message: 'upstream failure' } : f.defaultReply(path));
  await assert.rejects(() => f.service.checkQr('owner', qr.key), /500/);
  assert.equal(f.rows.size, 0);
  f.reply(undefined);
  f.state(800); // The provider consumes the key after returning 803.
  assert.equal((await f.service.checkQr('owner', qr.key)).status, 'authorized');
  assert.equal(f.calls.filter((call) => call.path === API.poll).length, 1);
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

test('parallel searches in one push refresh the session used by each failed request', async (t) => {
  const f = fixture(t); await f.connect();
  const late = deferred<unknown>(), firstRetry = deferred<unknown>(), retryStarted = deferred<void>();
  const songs = [{ id: songId, originalId: 1 }, { id: 'c'.repeat(32), originalId: 2 }];
  let oldRequests = 0;
  f.reply((path, business, token) => {
    if (path === API.searchSongs) {
      if (token === 'access') {
        oldRequests += 1;
        return oldRequests === 1 ? { code: 1406 } : late.promise;
      }
      if (business.keyword === 'song-1 artist') { retryStarted.resolve(); return firstRetry.promise; }
      firstRetry.resolve({ records: [songs[0]] });
      return { records: [songs[1]] };
    }
    if (path === API.tracks) return songs;
    return f.defaultReply(path);
  });
  const detail = { title: 'test', items: [1, 2].map((id) => ({ title: `song-${id}`, artist: 'artist',
    sourcePlatform: 'netease', sourceUrl: `https://music.163.com/song?id=${id}`, matches: [] })) } as unknown as PlaylistDetail;
  const writing = f.service.push('owner', detail);
  await retryStarted.promise;
  late.resolve({ code: 1406 });
  assert.equal((await writing).added, 2);
  assert.equal(f.calls.filter((call) => call.path === API.refresh).length, 1);
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

test('a song unavailable for playback can still be saved to a playlist', async (t) => {
  const f = fixture(t); await f.connect();
  f.reply((path) => path === API.searchSongs
    ? { records: [{ id: songId, originalId: 1, visible: false }] }
    : f.defaultReply(path));
  const detail = { title: 'test', items: [{ title: 'song', artist: 'artist', sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/song?id=1', matches: [] }] } as unknown as PlaylistDetail;
  const result = await f.service.push('owner', detail);
  assert.equal(result.added, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(f.calls.find((call) => call.path === API.add)?.business.songIdList, [songId]);
});

test('ID lookups overlap within a small bound and keep the source order', async (t) => {
  const f = fixture(t); await f.connect();
  let active = 0, peak = 0;
  const songs = Array.from({ length: 6 }, (_, i) => ({
    id: (i + 1).toString(16).padStart(32, '0'), originalId: i + 1,
  }));
  f.reply(async (path, business) => {
    if (path === API.searchSongs) {
      active += 1; peak = Math.max(peak, active);
      const id = Number(String(business.keyword).match(/song-(\d+)/)?.[1]);
      await new Promise((done) => setTimeout(done, (7 - id) * 5));
      active -= 1;
      return { records: [songs[id - 1]] };
    }
    if (path === API.tracks) return songs;
    return f.defaultReply(path);
  });
  const detail = { title: 'test', items: songs.map((song) => ({ title: `song-${song.originalId}`,
    artist: 'artist', sourcePlatform: 'netease',
    sourceUrl: `https://music.163.com/song?id=${song.originalId}`, matches: [] })) } as unknown as PlaylistDetail;
  const progress: Array<{ stage: string; completed: number; total: number }> = [];
  const result = await f.service.push('owner', detail, undefined, (stage, completed, total) => {
    progress.push({ stage, completed, total });
  });
  assert.ok(peak > 1, 'lookups must not wait for every previous request');
  assert.ok(peak <= 3, 'lookups must not flood the official API');
  assert.equal(result.added, 6);
  assert.deepEqual(progress.filter((value) => value.stage === 'resolving').map((value) => value.completed), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(progress.filter((value) => value.stage === 'writing').map((value) => value.completed), [0, 6]);
  assert.deepEqual(progress.filter((value) => value.stage === 'verifying').map((value) => value.completed), [0, 6]);
  assert.deepEqual(f.calls.find((call) => call.path === API.add)?.business.songIdList, songs.map((song) => song.id));
});

test('title-only lookup finds the exact original ID without substituting another version', async (t) => {
  const f = fixture(t); await f.connect();
  f.reply((path, business) => {
    if (path === API.searchSongs) return { records: business.keyword === 'song'
      ? [{ id: songId, originalId: 1, visible: false }]
      : [{ id: 'd'.repeat(32), originalId: 99, visible: true }] };
    return f.defaultReply(path);
  });
  const detail = { title: 'test', items: [{ title: 'song', artist: 'artist', sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/song?id=1', matches: [] }] } as unknown as PlaylistDetail;
  const result = await f.service.push('owner', detail);
  assert.equal(result.added, 1);
  assert.deepEqual(f.calls.filter((call) => call.path === API.searchSongs).map((call) => call.business.keyword), ['song artist', 'song']);
  assert.deepEqual(f.calls.find((call) => call.path === API.add)?.business.songIdList, [songId]);
});

test('write counts use the songs actually present, even when a batch reports success', async (t) => {
  const f = fixture(t); await f.connect();
  f.reply((path) => path === API.searchSongs ? { records: [
    { id: songId, originalId: 1 }, { id: 'c'.repeat(32), originalId: 2 },
  ] } : f.defaultReply(path));
  const detail = { title: 'test', items: [1, 2].map((id) => ({ title: 'song', artist: 'artist',
    sourcePlatform: 'netease', sourceUrl: `https://music.163.com/song?id=${id}`, matches: [] })) } as unknown as PlaylistDetail;
  const result = await f.service.push('owner', detail);
  assert.equal(result.added, 1);
  assert.equal(result.failed, 1);
  assert.match('warning' in result ? String(result.warning) : '', /1 首.*未.*确认/);
  assert.equal(f.calls.filter((call) => call.path === API.searchSongs).length, 1);
});

test('a verification timeout retains the created playlist and marks submitted songs unverified', async (t) => {
  const f = fixture(t); await f.connect();
  f.reply((path) => {
    if (path === API.tracks) throw new Error('temporary verification timeout');
    return f.defaultReply(path);
  });
  const detail = { title: 'test', items: [{ title: 'song', artist: 'artist', sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/song?id=1', matches: [] }] } as unknown as PlaylistDetail;
  const result = await f.service.push('owner', detail);
  assert.equal(result.url, 'https://music.163.com/#/playlist?id=101');
  assert.equal(result.added, 0);
  assert.equal(result.failed, 0);
  assert.equal('unverified' in result ? result.unverified : undefined, 1);
  assert.match(result.warning ?? '', /核对.*重复迁移/);
  assert.equal(f.calls.filter((call) => call.path === API.create).length, 1);
  assert.equal(f.calls.filter((call) => call.path === API.add).length, 1);
});

test('a failed parallel lookup drains active requests before disconnect finishes', { timeout: 2000 }, async (t) => {
  const f = fixture(t); await f.connect();
  const started = deferred<void>(), release = deferred<void>();
  let active = 0, searches = 0;
  f.reply(async (path) => {
    if (path !== API.searchSongs) return f.defaultReply(path);
    searches += 1; active += 1;
    if (searches === 3) started.resolve();
    await started.promise;
    if (searches === 3 && active === 3) { active -= 1; return { code: 500 }; }
    await release.promise;
    active -= 1;
    return { records: [] };
  });
  const detail = { title: 'test', items: [1, 2, 3, 4].map((id) => ({ title: `song-${id}`, artist: 'artist',
    sourcePlatform: 'netease', sourceUrl: `https://music.163.com/song?id=${id}`, matches: [] })) } as unknown as PlaylistDetail;
  const pushing = f.service.push('owner', detail);
  const rejected = assert.rejects(pushing, /500/);
  await started.promise;
  let disconnected = false;
  const disconnect = f.service.disconnect('owner').then(() => { disconnected = true; });
  await new Promise((done) => setImmediate(done));
  assert.equal(disconnected, false);
  release.resolve();
  await rejected; await disconnect;
  assert.equal(active, 0);
  assert.equal(searches, 3);
  assert.equal(f.calls.filter((call) => call.path === API.create).length, 0);
  assert.equal(f.rows.size, 0);
});

test('large writes verify every page and keep duplicate source songs out of the batch', async (t) => {
  const f = fixture(t); await f.connect();
  const songs = Array.from({ length: 501 }, (_, i) => ({ id: (i + 1).toString(16).padStart(32, '0'), originalId: i + 1 }));
  f.reply((path, business) => {
    if (path === API.searchSongs) {
      const group = Number(String(business.keyword).split('-')[1]);
      return { records: songs.slice(group * 100, (group + 1) * 100) };
    }
    if (path === API.tracks) return songs.slice(Number(business.offset), Number(business.offset) + 500);
    return f.defaultReply(path);
  });
  const items = songs.map((song, i) => ({ title: `group-${Math.floor(i / 100)}`, artist: '',
    sourcePlatform: 'netease', sourceUrl: `https://music.163.com/song?id=${song.originalId}`, matches: [] }));
  const detail = { title: 'test', items: [...items, items[0]] } as unknown as PlaylistDetail;
  const result = await f.service.push('owner', detail);
  assert.equal(result.added, 501); assert.equal(result.failed, 0); assert.equal(result.skipped, 1);
  assert.deepEqual(f.calls.filter((call) => call.path === API.tracks).map((call) => call.business.offset), [0, 500]);
  const batches = f.calls.filter((call) => call.path === API.add).map((call) => call.business.songIdList as string[]);
  assert.deepEqual(batches.map((batch) => batch.length), [500, 1]);
  assert.deepEqual(batches.flat(), songs.map((song) => song.id));
  assert.equal(f.calls.filter((call) => call.path === API.searchSongs).length, 6);
});

test('an unknown create response never falls back to adding to an existing playlist', async (t) => {
  const f = fixture(t); await f.connect();
  f.reply((path) => path === API.create ? {} : f.defaultReply(path));
  const detail = { title: 'test', items: [{ title: 'song', artist: 'artist', sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/song?id=1', matches: [] }] } as unknown as PlaylistDetail;
  await assert.rejects(() => f.service.push('owner', detail), /歌单标识/);
  assert.equal(f.calls.filter((call) => call.path === API.add).length, 0);
});


test('profile permission denial is distinguished from QR expiry without polling a consumed key', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('owner'); f.state(803);
  f.reply((path) => path === API.profile ? { code: 301 } : f.defaultReply(path));
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(() => f.service.checkQr('owner', qr.key), (error: unknown) => {
      const body = (error as { getResponse(): { code: string; message: string } }).getResponse();
      return body.code === 'NETEASE_PROFILE_FORBIDDEN' && body.message.includes('扫码授权已成功');
    });
    f.state(800);
  }
  assert.equal(f.calls.filter((call) => call.path === API.poll).length, 1);
  assert.equal(f.rows.size, 0);
});
