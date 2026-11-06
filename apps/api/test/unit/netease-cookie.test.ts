import test from 'node:test';
import assert from 'node:assert/strict';
import { NeteaseAccountService } from '../../src/accounts/netease-account.service';
import { NeteaseQrPool } from '../../src/accounts/netease-qr-pool';

// The service calls the CommonJS client lazily, so the tests can swap the
// single function they care about without touching the network.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const neteaseApi = require('NeteaseCloudMusicApi') as {
  login_status: (query: Record<string, unknown>) => Promise<unknown>;
};

class FakeCredentials {
  row: Record<string, unknown> | null = null;

  findOne(): Promise<Record<string, unknown> | null> {
    return Promise.resolve(this.row);
  }

  create(value: Record<string, unknown>): Record<string, unknown> {
    return { ...value };
  }

  save(value: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.row = value;
    return Promise.resolve(value);
  }
}

class FakeCipher {
  encrypt(value: string): string {
    return `enc:${value}`;
  }

  decrypt(value: string): string {
    return value.replace(/^enc:/, '');
  }
}

function buildService(): {
  service: NeteaseAccountService;
  credentials: FakeCredentials;
} {
  const credentials = new FakeCredentials();
  const service = new NeteaseAccountService(
    credentials as never,
    new FakeCipher() as never,
    new NeteaseQrPool(),
  );
  return { service, credentials };
}

async function withLoginStatus(
  handler: () => Promise<unknown>,
  run: () => Promise<void>,
): Promise<void> {
  const original = neteaseApi.login_status;
  neteaseApi.login_status = handler;
  try {
    await run();
  } finally {
    neteaseApi.login_status = original;
  }
}

test('cookie login rejects a cookie without MUSIC_U', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.connectWithCookie('user-1', 'NMTID=abc; __csrf=def'),
    /MUSIC_U/,
  );
});

test('cookie login stores the session once NetEase confirms the profile', async () => {
  const { service, credentials } = buildService();
  await withLoginStatus(
    async () => ({
      body: { code: 200, data: { code: 200, profile: { nickname: '阿渡' } } },
    }),
    async () => {
      const status = await service.connectWithCookie(
        'user-1',
        'MUSIC_U=cookie-value; __csrf=csrf-value; Max-Age=3600; HttpOnly',
      );
      assert.equal(status.connected, true);
      assert.equal(status.nickname, '阿渡');
    },
  );

  const stored = JSON.parse(
    String(credentials.row?.encryptedToken).replace(/^enc:/, ''),
  ) as { cookie: string };
  assert.equal(stored.cookie, 'MUSIC_U=cookie-value; __csrf=csrf-value');
});

test('cookie login refuses a cookie NetEase does not recognise', async () => {
  const { service, credentials } = buildService();
  await withLoginStatus(
    async () => ({ body: { code: 200, data: { code: 200 } } }),
    async () => {
      await assert.rejects(
        () => service.connectWithCookie('user-1', 'MUSIC_U=stale'),
        /Cookie/,
      );
    },
  );
  assert.equal(credentials.row, null);
});
