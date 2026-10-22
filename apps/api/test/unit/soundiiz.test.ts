import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSoundiizChunks,
  SoundiizService,
} from '../../src/apple/soundiiz.service';

function tracks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Track ${index + 1}`,
    artist: 'Artist',
  }));
}

test('buildSoundiizChunks returns no chunks for an empty playlist', () => {
  assert.deepEqual(buildSoundiizChunks([]), []);
});

test('buildSoundiizChunks keeps exactly 200 tracks in one chunk', () => {
  const chunks = buildSoundiizChunks(tracks(200));
  assert.equal(chunks.length, 1);
  assert.deepEqual(
    { index: chunks[0].index, from: chunks[0].from, to: chunks[0].to },
    { index: 1, from: 1, to: 200 },
  );
});

test('buildSoundiizChunks splits 201 tracks into 200 + 1', () => {
  const chunks = buildSoundiizChunks(tracks(201));
  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((chunk) => [chunk.index, chunk.from, chunk.to, chunk.items.length]),
    [
      [1, 1, 200, 200],
      [2, 201, 201, 1],
    ],
  );
});

test('buildSoundiizChunks covers a 450-track playlist in three chunks', () => {
  const chunks = buildSoundiizChunks(tracks(450));
  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((chunk) => chunk.items.length),
    [200, 200, 50],
  );
  assert.equal(chunks[2].from, 401);
  assert.equal(chunks[2].to, 450);
});


test('SoundiizService sends the Apple destination and caches the links', async () => {
  const calls: Record<string, unknown>[] = [];
  const detail = {
    id: 'playlist-1',
    title: '测试歌单',
    description: null,
    coverUrl: null,
    sourcePlatform: 'netease',
    sourceUrl: null,
    visibility: 'private',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    itemCount: 3,
    matches: {},
    items: [
      { title: '晴天', artist: '周杰伦' },
      { title: '富士山下', artist: '陈奕迅' },
      { title: '平凡之路', artist: '朴树' },
    ],
  };
  const http = {
    post: async (payload: Record<string, unknown>) => {
      calls.push(payload);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: 'success',
          shareUrl: `https://soundiiz.com/go/import-playlist/test-${calls.length}`,
          expiresAt: 1_900_000_000,
        }),
      };
    },
  };
  const service = new SoundiizService(
    {
      getDetail: async () => detail,
    } as never,
    http as never,
  );
  const first = await service.createLinks('user-1', 'playlist-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].destination, 'applemusicapp');
  assert.equal(calls[0].sourceName, '渡口');
  assert.equal(first.total, 3);
  assert.equal(first.links.length, 1);
  assert.equal(first.links[0].from, 1);
  assert.equal(first.links[0].to, 3);

  const second = await service.createLinks('user-1', 'playlist-1');
  assert.equal(calls.length, 1);
  assert.equal(second.links[0].url, first.links[0].url);
});
