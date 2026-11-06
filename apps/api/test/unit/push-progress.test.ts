import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { respondToPush } from '../../src/common/push-progress';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('the response delivers real progress while the write is still pending', async (t) => {
  const release = deferred<void>();
  const app = express();
  app.post('/push', (_req, res) => void respondToPush(res, 'text/event-stream', async (report) => {
    report?.('resolving', 1, 3);
    await release.promise;
    report?.('writing', 3, 3);
    // An out-of-order callback must not move the overall progress backwards.
    report?.('resolving', 2, 3);
    report?.('verifying', 3, 3);
    return { added: 3 };
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { release.resolve(); server.closeAllConnections(); server.close(); });
  const port = (server.address() as { port: number }).port;
  const response = await fetch(`http://127.0.0.1:${port}/push`, { method: 'POST' });
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('resolving')) text += decoder.decode((await reader.read()).value);
  assert.ok(text.includes('"percent":45'));
  assert.equal(text.includes('"type":"result"'), false);
  assert.equal(text.includes('"percent":100'), false);
  release.resolve();
  while (true) { const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value); }
  const events = text.split('\n\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(6)));
  const percentages = events.filter((event) => event.type === 'progress').map((event) => event.progress.percent);
  assert.deepEqual(percentages, [0, 45, 90, 90, 99, 100]);
  assert.deepEqual(events.at(-1), { type: 'result', result: { added: 3 } });
});

test('a failed write streams its safe error without a completion event', async (t) => {
  const app = express();
  app.post('/push', (_req, res) => void respondToPush(res, 'text/event-stream', async (report) => {
    report?.('writing', 1, 2);
    throw new UnauthorizedException('请重新扫码。');
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/push`, { method: 'POST' });
  const events = (await response.text()).split('\n\n').filter(Boolean).map((line) => JSON.parse(line.slice(6)));
  assert.deepEqual(events.at(-1), { type: 'error', status: 401, message: '请重新扫码。' });
  assert.deepEqual(events.filter((event) => event.type === 'progress').map((event) => event.progress.percent), [0, 80]);
});

test('existing JSON clients keep their original response contract', async (t) => {
  const app = express();
  app.post('/push', (_req, res) => void respondToPush(res, '*/*', async (report) => {
    assert.equal(report, undefined);
    return { added: 2 };
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/push`, { method: 'POST' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { added: 2 });
});

test('an unverified result retains its destination without reporting 100 percent', async (t) => {
  const app = express();
  app.post('/push', (_req, res) => void respondToPush(res, 'text/event-stream', async (report) => {
    report?.('verifying', 0, 3);
    return { added: 0, unverified: 3, url: 'https://music.163.com/#/playlist?id=101' };
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/push`, { method: 'POST' });
  const events = (await response.text()).split('\n\n').filter(Boolean).map((line) => JSON.parse(line.slice(6)));
  assert.deepEqual(events.filter((event) => event.type === 'progress').map((event) => event.progress.percent), [0, 90]);
  assert.equal(events.at(-1).type, 'result');
  assert.equal(events.at(-1).result.unverified, 3);
});
