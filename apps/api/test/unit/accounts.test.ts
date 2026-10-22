import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkArray,
  compactPlaylistName,
  neteaseIdFromUrl,
  normalizeCookie,
  qqMidFromUrl,
  uniqueNumericIds,
} from '../../src/accounts/account.utils';

test('normalizeCookie drops Set-Cookie attributes and keeps the last value', () => {
  const cookie = normalizeCookie([
    'MUSIC_U=abc; Max-Age=3600; Path=/; HttpOnly',
    'NMTID=xyz; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
    'MUSIC_U=def; Path=/',
  ]);
  assert.equal(cookie, 'MUSIC_U=def; NMTID=xyz');
});

test('compactPlaylistName is code-point safe and keeps the suffix', () => {
  assert.equal(compactPlaylistName('深夜渡口', 40), '深夜渡口 · 渡口');
  const long = '这是一张名字特别特别长的歌单'.repeat(4);
  const compact = compactPlaylistName(long, 20);
  assert.equal(Array.from(compact).length, 20);
  assert.ok(compact.endsWith(' · 渡口'));
});

test('neteaseIdFromUrl reads hash and song URLs', () => {
  assert.equal(neteaseIdFromUrl('https://music.163.com/#/song?id=123456'), '123456');
  assert.equal(neteaseIdFromUrl('https://music.163.com/song/789'), '789');
  assert.equal(neteaseIdFromUrl('https://y.qq.com/n/ryqq/playlist/1'), null);
});

test('qqMidFromUrl reads song detail URLs', () => {
  assert.equal(qqMidFromUrl('https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV'), '0039MnYb0qxYhV');
  assert.equal(qqMidFromUrl('https://music.163.com/#/song?id=1'), null);
});

test('uniqueNumericIds dedupes and rejects non-numeric values', () => {
  assert.deepEqual(uniqueNumericIds(['1', '1', 'abc', null, '2', '0']), ['1', '2']);
});

test('chunkArray keeps order', () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
