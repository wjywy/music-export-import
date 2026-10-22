import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeTracks, trackKey } from '../../src/common/tracks';
import {
  diceCoefficient,
  normalize,
  scoreCandidate,
} from '../../src/platforms/matching.service';

test('normalize folds width, case, spaces and punctuation', () => {
  assert.equal(normalize(' 周杰伦 - 晴天 (Live) '), '周杰伦晴天live');
  assert.equal(normalize('ＱＱ Music'), 'qqmusic');
});

test('trackKey uses normalized title and artist', () => {
  assert.equal(trackKey({ title: '晴天', artist: '周杰伦' }), '晴天|周杰伦');
  assert.equal(trackKey({ title: ' 晴天 ', artist: '周杰伦' }), '晴天|周杰伦');
  assert.equal(trackKey({ title: '晴天' }), '晴天|');
});

test('dedupeTracks keeps the first occurrence and reports the rest', () => {
  const input = [
    { title: '晴天', artist: '周杰伦' },
    { title: '富士山下', artist: '陈奕迅' },
    { title: '晴天 ', artist: '周杰伦 ' },
    { title: '晴天', artist: '翻唱歌手' },
  ];
  const result = dedupeTracks(input);
  assert.equal(result.tracks.length, 3);
  assert.equal(result.removed, 1);
  assert.deepEqual(result.tracks[2], input[3]);
});

test('dedupeTracks ignores entries without title and artist', () => {
  const result = dedupeTracks([
    { title: '', artist: '' },
    { title: '', artist: '' },
  ]);
  assert.equal(result.removed, 0);
});

test('diceCoefficient is symmetric and bounded', () => {
  assert.equal(diceCoefficient('晴天', '晴天'), 1);
  assert.equal(diceCoefficient('晴天', '富士山下'), 0);
  const value = diceCoefficient('富士山下', '富士山下 live');
  assert.ok(value > 0 && value < 1);
  assert.equal(value, diceCoefficient('富士山下 live', '富士山下'));
});

test('scoreCandidate ranks exact matches above loose covers', () => {
  const origin = { title: '晴天', artist: '周杰伦', durationMs: 269_000 };
  const exact = scoreCandidate(origin, {
    title: '晴天',
    artist: '周杰伦',
    durationMs: 269_000,
  });
  const cover = scoreCandidate(origin, {
    title: '晴天 (Live)',
    artist: '翻唱歌手',
    durationMs: 240_000,
  });
  assert.ok(exact > 0.99);
  assert.ok(cover < exact);
  assert.ok(cover < 0.7);
});

test('Apple scoring rejects live versions and duration outliers', () => {
  const origin = { title: '晴天', artist: '周杰伦', durationMs: 269_000 };
  const live = {
    title: '晴天 (Live)',
    artist: '周杰伦',
    durationMs: 269_000,
  };
  const longVersion = {
    title: '晴天',
    artist: '周杰伦',
    durationMs: 320_000,
  };

  assert.equal(scoreCandidate(origin, live, 'apple'), 0);
  assert.equal(scoreCandidate(origin, longVersion, 'apple'), 0);
  assert.ok(
    scoreCandidate(
      origin,
      { title: '晴天', artist: '周杰伦', durationMs: 268_000 },
      'apple',
    ) > 0.99,
  );
});

test('Apple scoring rejects a different artist on the same title', () => {
  const origin = { title: '晴天', artist: '周杰伦', durationMs: 269_000 };
  const otherArtist = {
    title: '晴天',
    artist: '林俊杰',
    durationMs: 269_000,
  };
  assert.equal(scoreCandidate(origin, otherArtist, 'apple'), 0);
});
