import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright-core';
import { closeQrBrowser, openQrSession } from '../../src/accounts/netease-qr-browser';

function browserFixture() {
  let cookies: Array<{ name: string; value: string }> = [];
  const page = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const context = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const browser = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const frame = {};
  function request(path: string) {
    return {
      url: () => `https://music.163.com/weapi/login/qrcode/${path}`,
      resourceType: () => 'xhr',
      headers: () => ({ 'x-login-chain-id': 'official-chain' }),
    };
  }
  function response(path: string, json: () => Promise<unknown>) {
    return {
      url: request(path).url,
      request: () => request(path),
      status: () => 200,
      ok: () => true,
      json,
    };
  }
  page.mainFrame = () => frame;
  page.route = async () => undefined;
  page.setDefaultTimeout = () => undefined;
  page.goto = async () => {
    page.emit('request', request('unikey'));
    page.emit('response', response('unikey', async () => ({ code: 200, unikey: 'fixture' })));
    page.emit('request', request('client/login'));
    return { ok: () => true };
  };
  context.newPage = async () => page;
  context.cookies = async () => cookies;
  context.close = async () => { context.emit('close'); };
  browser.newContext = async () => context;
  browser.close = async () => { context.emit('close'); browser.emit('disconnected'); };
  return {
    browser,
    context,
    redirectAfterLogin() {
      cookies = [{ name: 'MUSIC_U', value: 'fixture' }];
      page.emit('framenavigated', frame);
    },
    reply(code: number) {
      page.emit('response', response('client/login', async () => ({ code })));
    },
    replyWithUnreadableBody() {
      cookies = [{ name: 'MUSIC_U', value: 'fixture' }];
      page.emit('response', response('client/login', () => new Promise(() => {})));
    },
  };
}

test('confirmation survives an unreadable poll response body', async (t) => {
  const fixture = browserFixture();
  t.mock.method(chromium, 'launch', async () => fixture.browser as never);
  try {
    const session = await openQrSession();
    fixture.replyWithUnreadableBody();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(session.status, 'authorized');
    assert.equal(session.cookie, 'MUSIC_U=fixture');
  } finally {
    await closeQrBrowser();
  }
});

test('official post-login navigation is recognized without a readable poll body', async (t) => {
  const fixture = browserFixture();
  t.mock.method(chromium, 'launch', async () => fixture.browser as never);
  try {
    const session = await openQrSession();
    fixture.redirectAfterLogin();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(session.status, 'authorized');
    assert.equal(session.cookie, 'MUSIC_U=fixture');
  } finally {
    await closeQrBrowser();
  }
});

test('upstream expiry is exposed immediately instead of waiting for a local five-minute timer', async (t) => {
  const fixture = browserFixture();
  t.mock.method(chromium, 'launch', async () => fixture.browser as never);
  try {
    const session = await openQrSession();
    fixture.reply(800);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(session.status, 'expired');
    fixture.redirectAfterLogin();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(session.status, 'expired');
    assert.equal(session.cookie, null);
  } finally {
    await closeQrBrowser();
  }
});
