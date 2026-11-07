import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { NeteasePcQrClient } from '../../src/accounts/netease-pc-qr.client';
import { NeteasePcQrService } from '../../src/accounts/netease-pc-qr.service';
import { CredentialCipher } from '../../src/platforms/credential-cipher.service';
import type { PlatformCredential } from '../../src/common/entities/platform-credential.entity';
const { eapiReqDecrypt } = require('NeteaseCloudMusicApi/util/crypto');

function fixture(t: TestContext) {
  const config = new ConfigService({ CREDENTIALS_SECRET: 'test-secret' });
  const cipher = new CredentialCipher(config), rows = new Map<string, PlatformCredential>();
  const repository = {
    findOne: async ({ where }: { where: { userId: string } }) => rows.get(where.userId) ?? null,
    create: (data: Partial<PlatformCredential>) => ({ ...data, createdAt: new Date() }),
    save: async (row: PlatformCredential) => { rows.set(row.userId, { ...row }); return row; },
    delete: async ({ userId }: { userId: string }) => { rows.delete(userId); },
  };
  let state = 801, keys = 0;
  const requests: Array<{ path: string; cookie: string; device: string }> = [];
  const client = new NeteasePcQrClient();
  const fetch = t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
    const { url, data } = eapiReqDecrypt(new URLSearchParams(String(options.body)).get('params'));
    assert.equal(new URL(input).origin, 'https://interface.music.163.com');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const cookie = (options.headers as Record<string, string>).cookie;
    requests.push({ path: url, cookie, device: data.header.deviceId });
    assert.equal(data.type, 3);
    if (url.endsWith('/unikey')) return Response.json({ code: 200, unikey: `test-qr-key-${++keys}` },
      { headers: { 'set-cookie': `NMTID=session-${keys}; HttpOnly; Path=/` } });
    return Response.json({ code: state, nickname: '扫码账号' }, state === 803
      ? { headers: { 'set-cookie': `MUSIC_U=auth-${data.header.deviceId}; HttpOnly; Path=/` } } : {});
  });
  const service = new NeteasePcQrService(repository as never, cipher, client);
  t.after(() => service.onModuleDestroy());
  return { service, client, rows, cipher, requests, fetch, repository, state: (value: number) => { state = value; } };
}

test('PC QR uses independent cookies for each owner and stores only the confirmed account encrypted', async (t) => {
  const f = fixture(t);
  const [alice, same, bob] = await Promise.all([f.service.startQr('alice'), f.service.startQr('alice'), f.service.startQr('bob')]);
  assert.equal(alice.key, same.key); assert.notEqual(alice.key, bob.key);
  assert.equal(new URL(alice.url!).pathname, '/login');
  assert.deepEqual([...new URL(alice.url!).searchParams.keys()], ['codekey']);
  assert.notEqual(f.requests[0].device, f.requests[1].device);
  assert.equal((await f.service.checkQr('bob', alice.key)).status, 'expired');
  assert.equal(f.requests.length, 2);
  f.state(803);
  const result = await f.service.checkQr('alice', alice.key);
  assert.equal(result.status, 'authorized');
  assert.equal(f.requests[2].cookie.includes('NMTID=session-1'), true);
  assert.equal(f.requests[2].cookie.includes('session-2'), false);
  assert.equal(f.rows.has('bob'), false);
  const row = f.rows.get('alice')!;
  assert.ok(!row.encryptedToken.includes('MUSIC_U'));
  const session = JSON.parse(f.cipher.decrypt(row.encryptedToken));
  assert.ok(session.cookie.includes(`MUSIC_U=auth-${f.requests[0].device}`));
});

test('PC polling is single-flight and cached for three seconds, then confirmation is consumed once', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('alice');
  const now = Date.now(); const clock = t.mock.method(Date, 'now', () => now);
  const results = await Promise.all([f.service.checkQr('alice', qr.key), f.service.checkQr('alice', qr.key)]);
  assert.deepEqual(results.map(r => r.status), ['waiting', 'waiting']);
  f.state(803);
  assert.equal((await f.service.checkQr('alice', qr.key)).status, 'waiting');
  assert.equal(f.requests.length, 2);
  clock.mock.mockImplementation(() => now + 3001);
  assert.equal((await f.service.checkQr('alice', qr.key)).status, 'authorized');
  assert.equal(f.requests.length, 3);
  assert.equal((await f.service.checkQr('alice', qr.key)).status, 'expired');
});

test('PC persistence retry does not re-poll an already consumed QR', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('alice'); f.state(803);
  const save = f.repository.save; let fail = true;
  t.mock.method(f.repository, 'save', async (row: PlatformCredential) => {
    if (fail) { fail = false; throw new Error('database unavailable'); } return save(row);
  });
  await assert.rejects(() => f.service.checkQr('alice', qr.key), /database unavailable/);
  f.state(800);
  assert.equal((await f.service.checkQr('alice', qr.key)).status, 'authorized');
  assert.equal(f.requests.length, 2);
});

test('PC expiry closes the session and prevents another provider poll', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('alice');
  t.mock.method(Date, 'now', () => qr.expiresAt.getTime() + 1);
  assert.equal((await f.service.checkQr('alice', qr.key)).status, 'expired');
  assert.equal(f.requests.length, 1);
});

test('PC disconnect aborts opening requests without late authorization or cookie disclosure', async (t) => {
  const f = fixture(t); let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  f.fetch.mock.mockImplementation(async (_: string, options: RequestInit) => new Promise<Response>((_, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('MUSIC_U=must-not-leak')), { once: true }); began();
  }));
  const opening = f.service.startQr('alice');
  const rejected = assert.rejects(() => opening, error => error instanceof Error && /扫码请求未完成/.test(error.message) && !error.message.includes('must-not-leak'));
  await started; await f.service.disconnect('alice'); await rejected;
  assert.equal(f.rows.size, 0);
});

test('PC confirmation without MUSIC_U is rejected', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('alice');
  f.fetch.mock.mockImplementation(async () => Response.json({ code: 803 }));
  await assert.rejects(() => f.service.checkQr('alice', qr.key), /没有返回登录会话/);
  assert.equal(f.rows.size, 0);
});

test('disconnect drains a delayed PC credential save and deletes the late result', async (t) => {
  const f = fixture(t); const qr = await f.service.startQr('alice'); f.state(803);
  let began!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const save = f.repository.save;
  t.mock.method(f.repository, 'save', async (row: PlatformCredential) => { began(); await waiting; return save(row); });
  const completion = f.service.checkQr('alice', qr.key);
  const rejected = assert.rejects(completion, /关闭/);
  await started;
  const disconnect = f.service.disconnect('alice');
  assert.throws(() => f.service.startQr('alice'), /关闭/);
  release();
  await rejected; await disconnect;
  assert.equal(f.rows.size, 0);
});
