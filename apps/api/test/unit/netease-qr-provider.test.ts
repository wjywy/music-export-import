import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NeteaseAccountService } from '../../src/accounts/netease-account.service';
import { NeteaseOpenApiAccountService } from '../../src/accounts/netease-openapi-account.service';
import { NeteaseOpenApiClient } from '../../src/accounts/netease-openapi.client';
import { NeteaseQrPool } from '../../src/accounts/netease-qr-pool';
import type { BrowserQrSession } from '../../src/accounts/netease-qr-browser';
import { CredentialCipher } from '../../src/platforms/credential-cipher.service';
import type { PlatformCredential } from '../../src/common/entities/platform-credential.entity';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(t: TestContext, provider?: string) {
  const config = new ConfigService({ NETEASE_OPENAPI_APP_ID: 'personal-app',
    NETEASE_OPENAPI_APP_KEY: 'private-app-key', NETEASE_OPENAPI_PRIVATE_KEY: 'private-signing-key',
    CREDENTIALS_SECRET: 'test-only-secret', NETEASE_QR_PROVIDER: provider ?? 'browser' });
  const cipher = new CredentialCipher(config);
  const rows = new Map<string, PlatformCredential>();
  const repository = {
    findOne: async ({ where }: { where: { userId: string } }) => rows.get(where.userId) ?? null,
    create: (value: Partial<PlatformCredential>) => ({ ...value, createdAt: new Date() }),
    save: async (value: PlatformCredential) => { rows.set(value.userId, { ...value }); return value; },
    delete: async ({ userId }: { userId: string }) => { rows.delete(userId); },
  };
  const opened: BrowserQrSession[] = [], closed: BrowserQrSession[] = [];
  let opening: (() => Promise<BrowserQrSession>) | undefined;
  const session = (): BrowserQrSession => ({ context: {} as never, page: {} as never,
    unikey: `website-${opened.length + 1}`, chainId: `chain-${opened.length + 1}`,
    status: 'waiting', cookie: null, expiresAt: Date.now() + 120_000 });
  const pool = new NeteaseQrPool(async () => {
    const next = opening ? await opening() : session();
    opened.push(next); return next;
  }, async (value) => { closed.push(value); }, async () => undefined);
  const official = new NeteaseOpenApiAccountService(repository as never, cipher, new NeteaseOpenApiClient(config));
  const service = new NeteaseAccountService(repository as never, cipher, pool, official);
  t.after(async () => { await service.onModuleDestroy(); await pool.onModuleDestroy(); await official.onModuleDestroy(); });
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('personal OpenAPI must not be called'); });
  const api = require('NeteaseCloudMusicApi');
  const profile = t.mock.method(api, 'login_status', async ({ cookie }: { cookie: string }) =>
    ({ body: { code: 200, profile: { nickname: cookie } } }));
  return { service, official, pool, opened, closed, rows, cipher, profile, fetch, session, repository,
    opening(value: typeof opening) { opening = value; } };
}

test('explicit browser mode retains isolated website QR sessions for different users', async (t) => {
  const f = fixture(t);
  assert.equal((await f.service.status('alice')).connected, false);
  const [alice, bob] = await Promise.all([f.service.startQr('alice'), f.service.startQr('bob')]);
  assert.notEqual(alice.key, bob.key);
  assert.equal(new URL(alice.url!).pathname, '/st/platform/scanlogin');
  assert.equal(new URL(bob.url!).searchParams.get('chainId'), 'chain-2');
  assert.equal((await f.service.checkQr('bob', alice.key)).status, 'expired');
  assert.equal(f.profile.mock.callCount(), 0);
  for (const [index, name] of ['alice', 'bob'].entries()) {
    f.opened[index].cookie = `MUSIC_U=${name}`;
    f.opened[index].status = 'authorized';
  }
  const result = await Promise.all([f.service.checkQr('alice', alice.key), f.service.checkQr('bob', bob.key)]);
  assert.deepEqual(result.map((value) => value.status), ['authorized', 'authorized']);
  for (const name of ['alice', 'bob']) {
    const encrypted = f.rows.get(name)!.encryptedToken;
    assert.match(encrypted, /^v1\./);
    assert.ok(!encrypted.includes(`MUSIC_U=${name}`));
    assert.equal(JSON.parse(f.cipher.decrypt(encrypted)).cookie, `MUSIC_U=${name}`);
    assert.equal((await f.service.status(name)).connected, true);
  }
  await f.service.disconnect('alice');
  assert.equal((await f.service.status('alice')).connected, false);
  assert.equal((await f.service.status('bob')).connected, true);
  assert.equal(await f.service.cookieFor('bob'), 'MUSIC_U=bob');
  assert.equal(f.fetch.mock.callCount(), 0);
});

test('personal OpenAPI QR remains available only when explicitly selected', async (t) => {
  const f = fixture(t, 'openapi');
  const qr = { platform: 'netease' as const, key: 'personal', image: 'image', expiresAt: new Date(Date.now() + 300_000) };
  const start = t.mock.method(f.official, 'startQr', async () => qr);
  const check = t.mock.method(f.official, 'checkQr', async () => ({ status: 'waiting' as const }));
  assert.equal(await f.service.startQr('alice'), qr);
  assert.equal((await f.service.checkQr('alice', qr.key)).status, 'waiting');
  assert.equal(start.mock.calls[0].arguments[0], 'alice');
  assert.deepEqual(check.mock.calls[0].arguments, ['alice', qr.key]);
  assert.equal(f.opened.length, 0);
});

test('a cookie written after the last website response is detected by the next status check', async (t) => {
  const f = fixture(t);
  const qr = await f.service.startQr('bob');
  f.opened[0].context = { cookies: async () => [{ name: 'MUSIC_U', value: 'bob' }] } as never;
  const result = await f.service.checkQr('bob', qr.key);
  assert.equal(result.status, 'authorized');
  assert.equal(await f.service.cookieFor('bob'), 'MUSIC_U=bob');
  assert.equal(f.profile.mock.callCount(), 0, 'website authorization must not wait on a second Node profile request');
});

test('website writes use the scanning user cookie even while a personal AppID is configured', async (t) => {
  const f = fixture(t);
  const qr = await f.service.startQr('bob');
  f.opened[0].cookie = 'MUSIC_U=bob'; f.opened[0].status = 'authorized';
  await f.service.checkQr('bob', qr.key);
  const api = require('NeteaseCloudMusicApi');
  const create = t.mock.method(api, 'playlist_create', async () => ({ body: { code: 200, id: 987 } }));
  const write = t.mock.method(api, 'playlist_tracks', async () => ({ body: { code: 200 } }));
  const result = await f.service.push('bob', { title: 'test', items: [{ title: 'song', artist: 'artist',
    matches: [{ platform: 'netease', status: 'matched', remoteId: '123' }] }] } as never);
  assert.equal(result.added, 1);
  assert.equal(create.mock.calls[0].arguments[0].cookie, 'MUSIC_U=bob');
  assert.equal(write.mock.calls[0].arguments[0].cookie, 'MUSIC_U=bob');
  assert.equal(write.mock.calls[0].arguments[0].tracks, '123');
  assert.equal(f.fetch.mock.callCount(), 0);
});

test('a pre-existing personal authorization remains usable after the QR default changes', async (t) => {
  const f = fixture(t);
  f.rows.set('alice', { userId: 'alice', platform: 'netease', createdAt: new Date(),
    encryptedToken: f.cipher.encrypt(JSON.stringify({ kind: 'openapi', appId: 'personal-app',
      accessToken: 'access', refreshToken: 'refresh', accountId: 'account',
      device: { deviceId: 'device' }, expiresAt: Date.now() + 60_000 })) } as PlatformCredential);
  assert.equal((await f.service.status('alice')).connected, true);
  const pushed = { platform: 'netease' as const, playlistId: '123', name: 'test',
    url: 'https://music.163.com/playlist?id=123', added: 1, skipped: 0, failed: 0 };
  const write = t.mock.method(f.official, 'push', async () => pushed);
  assert.equal(await f.service.push('alice', {} as never), pushed);
  assert.equal(write.mock.callCount(), 1);
  assert.equal(f.opened.length, 0);
  await f.service.disconnect('alice');
  assert.equal(f.rows.size, 0);
});

test('unknown QR providers fail during configuration instead of silently selecting a login path', () => {
  assert.throws(() => new NeteaseOpenApiClient(new ConfigService({ NETEASE_QR_PROVIDER: 'typo' })), /NETEASE_QR_PROVIDER/);
});

test('disconnect drains a website authorization even while personal OpenAPI is configured', async (t) => {
  const f = fixture(t);
  const pending = deferred<unknown>(), started = deferred<void>();
  const save = f.repository.save;
  t.mock.method(f.repository, 'save', async (value: PlatformCredential) => { started.resolve(); await pending.promise; return save(value); });
  const qr = await f.service.startQr('alice');
  f.opened[0].cookie = 'MUSIC_U=alice'; f.opened[0].status = 'authorized';
  const checking = f.service.checkQr('alice', qr.key); await started.promise;
  const disconnect = f.service.disconnect('alice');
  await assert.rejects(() => f.service.startQr('alice'), /断开/);
  assert.equal((await f.service.checkQr('alice', qr.key)).status, 'expired');
  pending.resolve({ body: { code: 200, profile: { nickname: 'alice' } } });
  await checking; await disconnect;
  assert.equal(f.rows.size, 0);
  assert.equal(f.closed.length, 1);
});

test('disconnect also releases a website context that finishes opening late', async (t) => {
  const f = fixture(t);
  const opening = deferred<BrowserQrSession>(), started = deferred<void>();
  f.opening(() => { started.resolve(); return opening.promise; });
  const start = f.service.startQr('alice');
  const rejected = assert.rejects(start, /断开/); await started.promise;
  const disconnect = f.service.disconnect('alice');
  opening.resolve(f.session());
  await rejected; await disconnect;
  assert.equal(f.closed.length, 1);
  assert.equal(f.rows.size, 0);
});

test('default PC mode delegates to the isolated backend without opening Chromium or OpenAPI', async (t) => {
  const f = fixture(t, 'pc');
  const qr = { platform: 'netease' as const, key: 'pc-code', image: 'image', expiresAt: new Date(Date.now() + 180000) };
  let starts = 0, checks = 0, closes = 0;
  const pc = { startQr: async () => { starts++; return qr; }, checkQr: async () => { checks++; return { status: 'waiting' }; }, disconnect: async () => { closes++; } };
  const service = new NeteaseAccountService(f.repository as never, f.cipher, f.pool, f.official, pc as never);
  assert.equal(new NeteaseOpenApiClient(new ConfigService({})).qrProvider, 'pc');
  await service.status('alice');
  assert.equal(await service.startQr('alice'), qr);
  assert.equal((await service.checkQr('alice', qr.key)).status, 'waiting');
  await service.disconnect('alice');
  assert.deepEqual([starts, checks, closes], [1, 1, 1]);
  assert.equal(f.opened.length, 0);
  assert.equal(f.fetch.mock.callCount(), 0);
});
