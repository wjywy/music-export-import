import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserQrSession } from '../../src/accounts/netease-qr-browser';
import { NeteaseQrPool } from '../../src/accounts/netease-qr-pool';
import { NeteaseAccountService } from '../../src/accounts/netease-account.service';

function session(key: string): BrowserQrSession {
  return {
    context: {} as never,
    page: {} as never,
    unikey: key,
    chainId: 'official-chain',
    status: 'waiting',
    cookie: null,
    expiresAt: Date.now() + 120_000,
  };
}

function poolFixture(dispose?: () => Promise<void>) {
  const opened: BrowserQrSession[] = [];
  const closed: BrowserQrSession[] = [];
  const pool = new NeteaseQrPool(
    async () => {
      const next = session(String(opened.length + 1));
      opened.push(next);
      return next;
    },
    async (value) => { closed.push(value); await dispose?.(); },
    async () => undefined,
  );
  return { pool, opened, closed };
}

test('prepared codes are claimed once even when two users acquire concurrently', async () => {
  const { pool, opened, closed } = poolFixture();
  try {
    pool.prepare();
    pool.prepare();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(opened.length, 1);
    const [first, second] = await Promise.all([pool.acquire(), pool.acquire()]);
    assert.equal(first, opened[0]);
    assert.notEqual(first.unikey, second.unikey);
    await pool.release(first);
    await pool.release(first);
    assert.deepEqual(closed, [first]);
  } finally {
    await pool.onModuleDestroy();
  }
  assert.equal(closed.length, 2);
});

test('browser sessions are bounded and capacity returns after release', async () => {
  const { pool, closed } = poolFixture();
  const active = [];
  try {
    for (let i = 0; i < 2; i += 1) active.push(await pool.acquire());
    await assert.rejects(() => pool.acquire(), /繁忙/);
    await pool.release(active[0]);
    assert.ok(await pool.acquire());
  } finally {
    await pool.onModuleDestroy();
  }
  assert.equal(closed.length, 3);
});

test('a prepared QR remains available after thirty seconds if it is still fresh', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const { pool, opened } = poolFixture();
  try {
    pool.prepare();
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(35_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const qr = await pool.acquire();
    assert.equal(qr, opened[0]);
    assert.equal(opened.length, 1, 'a still-fresh prepared QR must not trigger another page load');
  } finally { await pool.onModuleDestroy(); }
});

test('a just-prepared context is counted once when two users acquire in the same turn', async () => {
  const { pool, opened } = poolFixture();
  try {
    pool.prepare();
    await Promise.resolve();
    const [first, second] = await Promise.all([pool.acquire(), pool.acquire()]);
    assert.equal(opened.length, 2);
    assert.notEqual(first.unikey, second.unikey);
    await assert.rejects(() => pool.acquire(), /繁忙/);
  } finally {
    await pool.onModuleDestroy();
  }
});

test('a failed background initialization does not poison an explicit retry', async () => {
  let calls = 0;
  const pool = new NeteaseQrPool(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('bootstrap failed');
      return session('retry');
    },
    async () => undefined,
    async () => undefined,
  );
  try {
    pool.prepare();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((await pool.acquire()).unikey, 'retry');
    assert.equal(calls, 2);
  } finally {
    await pool.onModuleDestroy();
  }
});

test('expiry and shutdown discard codes instead of handing out a dead browser', async () => {
  const { pool, opened, closed } = poolFixture();
  pool.prepare();
  await new Promise<void>((resolve) => setImmediate(resolve));
  opened[0].expiresAt = Date.now() - 1;
  await assert.rejects(() => pool.acquire(), /过期/);
  assert.deepEqual(closed, [opened[0]]);
  await pool.onModuleDestroy();
  await assert.rejects(() => pool.acquire(), /繁忙/);
});

test('an unused prepared code closes at its real expiry', async () => {
  let closes = 0;
  const pool = new NeteaseQrPool(
    async () => ({ ...session('idle'), expiresAt: Date.now() + 5 }),
    async () => { closes += 1; },
    async () => undefined,
  );
  try {
    pool.prepare();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(closes, 1);
  } finally {
    await pool.onModuleDestroy();
  }
  assert.equal(closes, 1);
});

test('shutdown also closes a browser that finishes opening after shutdown', async () => {
  let finish!: (value: BrowserQrSession) => void;
  const closed: BrowserQrSession[] = [];
  const pool = new NeteaseQrPool(
    () => new Promise((resolve) => { finish = resolve; }),
    async (value) => { closed.push(value); },
    async () => undefined,
  );
  const acquiring = pool.acquire();
  const rejected = assert.rejects(acquiring, /重启/);
  await pool.onModuleDestroy();
  const late = session('late');
  finish(late);
  await rejected;
  assert.deepEqual(closed, [late]);
});

function serviceFixture(dispose?: () => Promise<void>) {
  const fixture = poolFixture(dispose);
  let row: Record<string, unknown> | null = null;
  const credentials = {
    findOne: async () => row,
    create: (value: Record<string, unknown>) => ({ ...value }),
    save: async (value: Record<string, unknown>) => { row = value; },
    delete: async () => { row = null; },
  };
  const service = new NeteaseAccountService(credentials as never, {
    encrypt: (value: string) => `encrypted:${value}`,
    decrypt: (value: string) => value.slice('encrypted:'.length),
  } as never, fixture.pool);
  return { ...fixture, service, credentials, saved: () => row };
}

test('missing CHROME_PATH still uses official browser sessions and reuses an owned pending code', async () => {
  const original = process.env.CHROME_PATH;
  delete process.env.CHROME_PATH;
  const { service, pool, opened } = serviceFixture();
  try {
    await service.status('owner');
    const [first, second] = await Promise.all([service.startQr('owner'), service.startQr('owner')]);
    assert.equal(first.key, second.key);
    assert.equal((await service.startQr('owner')).key, first.key);
    assert.equal(opened.length, 1);
    assert.match(first.image, /^data:image\/png;base64,/);
    assert.equal(new URL(first.url!).searchParams.get('chainId'), 'official-chain');
    assert.equal(first.expiresAt.getTime(), opened[0].expiresAt);
    assert.equal((await service.checkQr('another-user', first.key)).status, 'expired');
    assert.equal((await service.checkQr('owner', first.key)).status, 'waiting');
  } finally {
    if (original === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = original;
    await service.onModuleDestroy?.();
    await pool.onModuleDestroy();
  }
});

test('upstream expiry releases the browser and permits a fresh code', async () => {
  const { service, pool, opened, closed } = serviceFixture();
  try {
    const qr = await service.startQr('owner');
    opened[0].status = 'expired';
    assert.equal((await service.checkQr('owner', qr.key)).status, 'expired');
    assert.equal(closed.length, 1);
    const replacement = await service.startQr('owner');
    assert.notEqual(replacement.key, qr.key);
  } finally {
    await service.onModuleDestroy();
    await pool.onModuleDestroy();
  }
});

test('failed persistence can be retried and concurrent polls save authorization only once', async () => {
  const { service, pool, opened, closed, saved, credentials } = serviceFixture();
  const originalSave = credentials.save;
  let attempts = 0;
  credentials.save = async (value) => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary storage failure');
    await originalSave(value);
  };
  try {
    const qr = await service.startQr('owner');
    opened[0].status = 'authorized'; opened[0].cookie = 'MUSIC_U=fixture';
    await assert.rejects(() => service.checkQr('owner', qr.key), /temporary storage failure/);
    assert.equal(closed.length, 0);
    assert.equal(saved(), null);
    const results = await Promise.all([service.checkQr('owner', qr.key), service.checkQr('owner', qr.key)]);
    assert.deepEqual(results.map((result) => result.status), ['authorized', 'authorized']);
    assert.equal(attempts, 2);
    assert.equal(saved()?.userId, 'owner');
    assert.equal(closed.length, 1);
  } finally { await service.onModuleDestroy(); await pool.onModuleDestroy(); }
});

test('disconnect drains persistence even after expiry removes the QR context', async () => {
  const { service, pool, opened, saved, credentials } = serviceFixture();
  const originalSave = credentials.save;
  let finish!: () => void, started!: () => void;
  const pending = new Promise<void>((done) => { finish = done; });
  const saving = new Promise<void>((done) => { started = done; });
  credentials.save = async (value) => { started(); await pending; await originalSave(value); };
  try {
    const qr = await service.startQr('owner');
    opened[0].status = 'authorized'; opened[0].cookie = 'MUSIC_U=fixture';
    const authorization = service.checkQr('owner', qr.key);
    await saving;
    opened[0].expiresAt = Date.now() - 1;
    assert.equal((await service.checkQr('owner', qr.key)).status, 'expired');
    let disconnected = false;
    const disconnect = service.disconnect('owner').then(() => { disconnected = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(disconnected, false);
    finish();
    await Promise.all([authorization, disconnect]);
    assert.equal(saved(), null);
  } finally { finish(); await service.onModuleDestroy(); await pool.onModuleDestroy(); }
});

test('disconnect prevents a late poll from starting authorization', async () => {
  const { service, pool, opened, saved } = serviceFixture();
  try {
    const qr = await service.startQr('owner');
    opened[0].status = 'authorized'; opened[0].cookie = 'MUSIC_U=fixture';
    const disconnect = service.disconnect('owner');
    assert.equal((await service.checkQr('owner', qr.key)).status, 'expired');
    await disconnect;
    assert.equal(saved(), null);
  } finally { await service.onModuleDestroy(); await pool.onModuleDestroy(); }
});

test('confirmed login responds before a stalled browser close finishes', async () => {
  let finish!: () => void;
  const closing = new Promise<void>((done) => { finish = done; });
  const { service, pool, opened, saved } = serviceFixture(() => closing);
  try {
    const qr = await service.startQr('owner');
    opened[0].status = 'authorized'; opened[0].cookie = 'MUSIC_U=fixture';
    let completed = false;
    const checking = service.checkQr('owner', qr.key).then((result) => { completed = true; return result; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(completed, true);
    assert.equal(saved()?.userId, 'owner');
    finish();
    assert.equal((await checking).status, 'authorized');
  } finally { finish(); await service.onModuleDestroy(); await pool.onModuleDestroy(); }
});
