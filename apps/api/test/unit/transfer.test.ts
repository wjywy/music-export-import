import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTransferPlan,
  chunkTransferLines,
  clampChunkChars,
  transferLine,
  type TransferTrackInput,
} from '../../src/playlists/transfer';

const tracks: TransferTrackInput[] = [
  {
    title: '晴天',
    artist: '周杰伦',
    matched: true,
    matchedTitle: '晴天',
    matchedArtist: '周杰伦',
  },
  {
    title: '富士山下',
    artist: '陈奕迅',
    matched: false,
  },
  {
    title: '平凡之路',
    artist: '朴树',
    matched: false,
  },
];

test('transferLine prefers matched target metadata and supports three formats', () => {
  const matched = tracks[0];
  assert.equal(transferLine(matched, 'song-singer'), '晴天 - 周杰伦');
  assert.equal(transferLine(matched, 'singer-song'), '周杰伦 - 晴天');
  assert.equal(transferLine(matched, 'song-only'), '晴天');

  const fallback: TransferTrackInput = {
    title: ' 富士山下 ',
    artist: ' 陈奕迅 ',
    matched: true,
    matchedTitle: null,
    matchedArtist: null,
  };
  assert.equal(transferLine(fallback, 'song-singer'), '富士山下 - 陈奕迅');
});

test('chunkTransferLines never splits a song line and keeps track ranges', () => {
  const lines = ['晴天 - 周杰伦', '富士山下 - 陈奕迅', '平凡之路 - 朴树'];
  const chunks = chunkTransferLines(lines, 15);

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map((chunk) => [chunk.fromTrack, chunk.toTrack, chunk.trackCount]),
    [
      [1, 1, 1],
      [2, 2, 1],
      [3, 3, 1],
    ],
  );
  for (const chunk of chunks) {
    assert.ok(chunk.chars <= 15);
    assert.ok(lines.includes(chunk.text));
  }
});

test('chunkTransferLines packs lines up to the limit', () => {
  const lines = ['a', 'b', 'c', 'd'];
  const chunks = chunkTransferLines(lines, 3);
  assert.deepEqual(
    chunks.map((chunk) => chunk.text),
    ['a\nb', 'c\nd'],
  );
  assert.deepEqual(
    chunks.map((chunk) => [chunk.fromTrack, chunk.toTrack]),
    [
      [1, 2],
      [3, 4],
    ],
  );
});

test('chunkTransferLines keeps an oversized line in its own chunk', () => {
  const long = 'x'.repeat(50);
  const chunks = chunkTransferLines(['短', long, '短'], 20);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[1].text, long);
  assert.equal(chunks[1].chars, 50);
});

test('buildTransferPlan for QQ makes text chunks and a merge note', () => {
  const manyTracks: TransferTrackInput[] = Array.from({ length: 30 }, (_, index) => ({
    title: `曲目${index + 1}`,
    artist: `歌手${index + 1}`,
    matched: index === 0,
    matchedTitle: index === 0 ? '曲目 1' : null,
    matchedArtist: index === 0 ? '歌手 1' : null,
  }));
  const plan = buildTransferPlan({
    target: 'qq',
    title: '深夜渡口',
    sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/#/playlist?id=1',
    tracks: manyTracks,
    format: 'song-singer',
    chunkChars: 200,
  });

  assert.equal(plan.targetName, 'QQ 音乐');
  assert.equal(plan.total, 30);
  assert.equal(plan.matched, 1);
  assert.ok(plan.chunks.length >= 2);
  assert.match(plan.text, /^曲目 1 - 歌手 1/);
  assert.match(plan.text, /曲目30 - 歌手30$/);
  assert.match(plan.note ?? '', /还没有匹配到 QQ 音乐/);
  assert.match(plan.note ?? '', /手动合并/);
  assert.equal(plan.sourceLink, null);
  assert.match(plan.importUrl, /y\.qq\.com/);
});

test('buildTransferPlan for NetEase returns the QQ share link when available', () => {
  const plan = buildTransferPlan({
    target: 'netease',
    title: '通勤路上',
    sourcePlatform: 'qq',
    sourceUrl: 'https://y.qq.com/n/ryqq/playlist/123456',
    tracks,
  });

  assert.equal(plan.targetName, '网易云音乐');
  assert.equal(plan.sourceLink, 'https://y.qq.com/n/ryqq/playlist/123456');
  assert.match(plan.steps.join(' '), /导入外部歌单/);
  assert.match(plan.note ?? '', /原始链接/);
});

test('buildTransferPlan for NetEase explains when there is no QQ link', () => {
  const plan = buildTransferPlan({
    target: 'netease',
    title: '渡口自建',
    sourcePlatform: 'netease',
    sourceUrl: 'https://music.163.com/#/playlist?id=1',
    tracks,
  });

  assert.equal(plan.sourceLink, null);
  assert.match(plan.steps.join(' '), /不能直接粘贴文字/);
  assert.match(plan.note ?? '', /没有可用的 QQ 音乐原始链接/);
});

test('clampChunkChars keeps the value inside the supported range', () => {
  assert.equal(clampChunkChars(undefined), 900);
  assert.equal(clampChunkChars(10), 200);
  assert.equal(clampChunkChars(10_000), 2000);
  assert.equal(clampChunkChars(640), 640);
});
