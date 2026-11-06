import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { NETEASE_OPENAPI as API, NeteaseOpenApiClient } from '../../src/accounts/netease-openapi.client';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const settings = { NETEASE_OPENAPI_APP_ID: 'unit-app', NETEASE_OPENAPI_APP_KEY: 'unit-app-secret',
  NETEASE_OPENAPI_PRIVATE_KEY: privateDer };
const context = { device: { deviceId: 'unit-device' }, accessToken: 'unit-access-token' };

test('OpenAPI GET signatures verify independently and never transmit the private key', async (t) => {
  let verified = false;
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://openapi.music.163.com');
    assert.equal(url.pathname, API.profile);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const params = Object.fromEntries(url.searchParams);
    const signature = params.sign;
    delete params.sign;
    const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
    verified = verify('sha256', Buffer.from(canonical), pair.publicKey, Buffer.from(signature, 'base64'));
    assert.equal(params.accessToken, context.accessToken);
    assert.deepEqual(JSON.parse(params.device), context.device);
    assert.ok(!String(input).includes(privateDer));
    assert.ok(!String(input).includes(settings.NETEASE_OPENAPI_APP_KEY));
    return Response.json({ code: 200, data: { id: 'profile' } });
  });
  const client = new NeteaseOpenApiClient(new ConfigService(settings));
  assert.deepEqual(await client.request(API.profile, {}, context), { id: 'profile' });
  assert.equal(verified, true);
});

test('POST uses signed JSON and supports escaped PEM configuration', async (t) => {
  const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    assert.equal(new URL(String(input)).search, '');
    assert.equal(options.method, 'POST');
    const params = JSON.parse(options.body as string);
    const signature = params.sign;
    delete params.sign;
    const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
    assert.equal(verify('sha256', Buffer.from(canonical), pair.publicKey, Buffer.from(signature, 'base64')), true);
    assert.deepEqual(JSON.parse(params.bizContent), { songIdList: ['encrypted-song'] });
    return Response.json({ code: 200, data: true });
  });
  const client = new NeteaseOpenApiClient(new ConfigService({ ...settings,
    NETEASE_OPENAPI_PRIVATE_KEY: pem.replace(/\n/g, '\\n') }));
  assert.equal(await client.request(API.add, { songIdList: ['encrypted-song'] }, context, 'POST'), true);
});

test('official QR initialization preserves one anonymous context and the official URL', async (t) => {
  const requests: Array<Record<string, string>> = [];
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    const url = new URL(String(input));
    const params = options.method === 'POST' ? JSON.parse(options.body as string) : Object.fromEntries(url.searchParams);
    requests.push(params);
    return Response.json({ code: 200, data: url.pathname === API.anonymous
      ? { accessToken: 'unit-anonymous' } : { uniKey: 'unit-qr', qrCodeUrl: 'https://163cn.tv/official' } });
  });
  const client = new NeteaseOpenApiClient(new ConfigService(settings));
  const started = Date.now();
  const qr = await client.startQr();
  assert.equal(qr.url, 'https://163cn.tv/official');
  assert.equal(qr.key, 'unit-qr');
  assert.equal(qr.context.accessToken, 'unit-anonymous');
  assert.equal(requests[0].device, requests[1].device);
  assert.equal(JSON.parse(requests[0].device).os, 'ncmcli');
  assert.ok(JSON.parse(requests[0].device).clientIp);
  assert.deepEqual(JSON.parse(requests[1].bizContent), { type: 2, expiredKey: '300' });
  assert.ok(qr.expiresAt >= started + 300_000 && qr.expiresAt <= Date.now() + 300_000);
  assert.notEqual(client.newDevice().deviceId, client.newDevice().deviceId);
});

test('transport, configuration and upstream errors do not echo credentials', async (t) => {
  const client = new NeteaseOpenApiClient(new ConfigService(settings));
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unit-access-token in signed URL'); });
  await assert.rejects(() => client.request(API.profile, {}, context), (error: Error) =>
    /连接失败|超时/.test(error.message) && !error.message.includes('unit-access-token'));
  fetchMock.mock.mockImplementation(async () => Response.json({ code: 403, message: 'unit-access-token' }));
  await assert.rejects(() => client.request(API.profile, {}, context), (error: Error) =>
    error.message.includes('403') && !error.message.includes('unit-access-token'));
  const bad = new NeteaseOpenApiClient(new ConfigService({ ...settings, NETEASE_OPENAPI_PRIVATE_KEY: 'invalid-private' }));
  const calls = fetchMock.mock.callCount();
  await assert.rejects(() => bad.request(API.profile, {}, context), /私钥无效/);
  assert.equal(fetchMock.mock.callCount(), calls);
  const incomplete = new NeteaseOpenApiClient(new ConfigService({
    NETEASE_OPENAPI_APP_ID: '', NETEASE_OPENAPI_PRIVATE_KEY: '', NETEASE_OPENAPI_APP_KEY: 'unit-key' }));
  assert.equal(incomplete.enabled, true);
  await assert.rejects(() => incomplete.request(API.profile, {}, context), /配置/);
  assert.equal(fetchMock.mock.callCount(), calls);
  assert.throws(() => client.token({ accessToken: 'missing-refresh' }), /完整/);
  assert.ok(client.token({ accessToken: 'access', refreshToken: 'refresh', expiresTime: 3600 }).expiresAt > Date.now());
});


test('QR refresh reuses an anonymous token and a stable alphanumeric device per user', async (t) => {
  let anonymousCalls = 0;
  const pollTokens: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    const url = new URL(String(input));
    const params = options.method === 'POST' ? JSON.parse(options.body as string) : Object.fromEntries(url.searchParams);
    const device = JSON.parse(params.device);
    assert.match(device.deviceId, /^[a-zA-Z0-9]{1,64}$/);
    if (url.pathname === API.anonymous) {
      anonymousCalls++;
      return Response.json({ code: 200, data: { accessToken: 'anon+/=' } });
    }
    if (url.pathname === API.poll) {
      pollTokens.push(params.accessToken);
      assert.deepEqual(JSON.parse(params.bizContent), { key: 'qr', clientId: settings.NETEASE_OPENAPI_APP_ID });
      return Response.json({ code: 200, data: { status: 801 } });
    }
    return Response.json({ code: 200, data: { uniKey: 'qr', qrCodeUrl: 'https://163cn.tv/official' } });
  });
  const client = new NeteaseOpenApiClient(new ConfigService(settings));
  const first = await client.startQr('owner');
  const second = await client.startQr('owner');
  await client.poll(first.key, first.context);
  await client.poll(second.key, second.context);
  assert.equal(anonymousCalls, 1);
  assert.deepEqual(pollTokens, ['anon+/=', 'anon+/=']);
  assert.equal(first.context.device.deviceId, client.newDevice('owner').deviceId);
  assert.notEqual(first.context.device.deviceId, client.newDevice('other').deviceId);
  assert.throws(() => client.token({ accessToken: 'null', refreshToken: 'null', expireTime: 604800 }), /完整/);
  const long = 'a+/='.repeat(150);
  assert.equal(client.token({ accessToken: long, refreshToken: long, expireTime: 604800 }).accessToken, long);
});
