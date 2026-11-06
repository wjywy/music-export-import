import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from '../../src/accounts/accounts.service';
import { PlaylistsService } from '../../src/playlists/playlists.service';

test('migration searches only new songs, reuses negative results and keeps explicit re-matching available', async () => {
  const items = [{ id: 'known', title: 'known', artist: 'artist' },
    { id: 'not-found', title: 'not-found', artist: 'artist' },
    { id: 'new', title: 'new', artist: 'artist' }];
  const known = { itemId: 'known', platform: 'netease', status: 'matched', remoteId: '1', source: 'auto' };
  const negative = { itemId: 'not-found', platform: 'netease', status: 'missing', remoteId: '', source: 'auto' };
  const records = [known, negative];
  const searched: string[] = [];
  const playlists = new PlaylistsService(
    { findOne: async () => ({ id: 'playlist', ownerId: 'owner' }) } as never,
    { find: async () => items } as never,
    { find: async () => records, create: (value: object) => ({ ...value }),
      save: async (value: typeof known) => { records.push(value); return value; } } as never,
    { find: async () => [] } as never,
    {} as never,
    { probe: async () => {}, best: async (_platform: string, item: { title: string }) => {
      searched.push(item.title);
      return { hit: { sourceId: '2', title: item.title, artist: 'artist' }, score: 1 };
    } } as never,
  );
  playlists.getDetail = async () => ({ title: 'test', items: items.map((item) => ({ ...item,
    matches: records.filter((record) => record.itemId === item.id) })) }) as never;
  let pushed = false;
  const service = new AccountsService({ push: async () => { pushed = true; return {}; } } as never,
    {} as never, playlists);
  const progress: number[] = [];
  await service.push('owner', 'playlist', 'netease', undefined, (stage, completed) => {
    if (stage === 'matching') progress.push(completed);
  });
  assert.equal(pushed, true);
  assert.deepEqual(searched, ['new']);
  assert.equal(known.remoteId, '1');
  assert.equal(negative.status, 'missing');
  assert.deepEqual(progress, [0, 1]);
  searched.length = 0;
  await service.push('owner', 'playlist', 'netease');
  assert.deepEqual(searched, [], 'a second push must not re-query a previous negative result');
  searched.length = 0;
  await playlists.match('playlist', 'owner', 'netease');
  assert.deepEqual(searched, ['known', 'not-found', 'new'], 'an explicit re-match must still search automatic matches');
});

for (const platform of ['netease', 'qq'] as const) {
  test(`${platform} directly writes an already matched playlist without probing or re-matching`, async () => {
    let reads = 0, writes = 0;
    const detail = { items: [
      { id: 'known', matches: [{ platform, status: 'matched', remoteId: '1' }] },
      { id: 'not-found', matches: [{ platform, status: 'missing', remoteId: null }] },
    ] };
    const service = new AccountsService({ push: async () => { writes += 1; return {}; } } as never,
      { push: async () => { writes += 1; return {}; } } as never,
      { getDetail: async () => { reads += 1; return detail; },
        match: async () => { throw new Error('must not re-match saved results'); } } as never);
    await service.push('owner', 'playlist', platform);
    assert.equal(reads, 1);
    assert.equal(writes, 1);
  });
}

test('a partial search timeout remains retryable instead of becoming a saved no-hit', async () => {
  const items = [{ id: 'good', title: 'good', artist: 'artist' },
    { id: 'temporary', title: 'temporary', artist: 'artist' },
    { id: 'absent', title: 'absent', artist: 'artist' }];
  const records: Array<{ itemId: string; status: string }> = [];
  const searched: string[] = [];
  let failing = true;
  const playlists = new PlaylistsService(
    { findOne: async () => ({ id: 'playlist', ownerId: 'owner' }) } as never,
    { find: async () => items } as never,
    { find: async () => records, create: (value: object) => ({ ...value }),
      save: async (value: typeof records[number]) => { records.push(value); return value; } } as never,
    { find: async () => [] } as never, {} as never,
    { probe: async () => {}, best: async (_platform: string, item: { title: string }) => {
      searched.push(item.title);
      if (item.title === 'temporary' && failing) throw new Error('temporary timeout');
      return { hit: item.title === 'absent' ? null : { sourceId: '1', title: item.title, artist: 'artist' }, score: 1 };
    } } as never,
  );
  playlists.getDetail = async () => ({ title: 'test', items: items.map((item) => ({ ...item,
    matches: records.filter((record) => record.itemId === item.id).map((record) => ({ ...record, platform: 'netease' })) })) }) as never;
  const service = new AccountsService({ push: async () => ({}) } as never, {} as never, playlists);
  await service.push('owner', 'playlist', 'netease');
  assert.equal(records.find((record) => record.itemId === 'absent')?.status, 'missing');
  assert.equal(records.some((record) => record.itemId === 'temporary'), false);
  failing = false; searched.length = 0;
  await service.push('owner', 'playlist', 'netease');
  assert.deepEqual(searched, ['temporary']);
  assert.equal(records.find((record) => record.itemId === 'temporary')?.status, 'matched');
});

test('a pending migration cannot be started twice and releases its lock afterwards', async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const detail = { items: [{ sourcePlatform: 'netease', sourceUrl: 'https://music.163.com/song?id=1', matches: [] }] };
  let writes = 0;
  const service = new AccountsService({ push: async () => { writes += 1; await gate; return {}; } } as never,
    {} as never, { getDetail: async () => detail } as never);
  const first = service.push('owner', 'playlist', 'netease');
  await assert.rejects(() => service.push('owner', 'playlist', 'netease'), /正在写入/);
  release(); await first;
  await service.push('owner', 'playlist', 'netease');
  assert.equal(writes, 2);
});

test('failure to query a new song does not block existing usable matches', async () => {
  const detail = { items: [
    { id: 'known', matches: [{ platform: 'netease', status: 'matched', remoteId: '1' }] },
    { id: 'new', matches: [] },
  ] };
  let writes = 0;
  const { PlatformError } = await import('../../src/common/platform-error');
  const service = new AccountsService({ push: async () => { writes += 1;
    return { added: 1, skipped: 1, failed: 0 }; } } as never, {} as never,
    { getDetail: async () => detail, match: async () => { throw new PlatformError('UNAVAILABLE', 'temporary timeout'); } } as never);
  const result = await service.push('owner', 'playlist', 'netease');
  assert.equal(writes, 1);
  assert.equal(result.added, 1);
  assert.match(result.warning ?? '', /1 首.*查询.*失败/);
});
