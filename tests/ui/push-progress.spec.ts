import { expect, test, type Page } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';

async function progressServer() {
  let response!: ServerResponse;
  let started!: () => void;
  const ready = new Promise<void>((done) => { started = done; });
  let requests = 0;
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,accept');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    requests += 1;
    response = res;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
    res.write(`data: ${JSON.stringify({ type: 'progress', progress: { stage: 'preparing', completed: 0, total: 0, percent: 0 } })}\n\n`);
    started();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}/push`,
    ready,
    count: () => requests,
    progress(stage: string, completed: number, total: number, percent: number) {
      response.write(`data: ${JSON.stringify({ type: 'progress', progress: { stage, completed, total, percent } })}\n\n`);
    },
    event(value: unknown) { response.write(`data: ${JSON.stringify(value)}\n\n`); },
    end() { response.end(); },
    close() { server.closeAllConnections(); server.close(); },
  };
}

async function openMigration(page: Page, url: string, start = true, connected = () => true) {
  await page.route('**/api/accounts', (route) => route.fulfill({ json: { accounts: [
    { platform: 'netease', connected: connected(), nickname: '进度测试' },
    { platform: 'qq', connected: false },
  ] } }));
  await page.route('**/api/playlists/*/push', (route) => route.continue({ url }));
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');
  await page.getByText('深夜渡口').first().click();
  await page.getByRole('button', { name: /迁移/ }).click();
  const dialog = page.getByRole('dialog', { name: '迁移这张歌单' });
  await dialog.getByRole('group', { name: '目标平台' }).getByRole('button', { name: '网易云音乐' }).click();
  if (start) await dialog.getByRole('button', { name: /一键迁移/ }).click();
  return dialog;
}

test('QR status retries a transient error and continues immediately after phone confirmation', async ({ page }) => {
  const stream = await progressServer();
  let checks = 0, connected = false;
  try {
    await page.route('**/api/accounts/netease/qr', (route) => route.fulfill({ json: {
      platform: 'netease', key: 'retry-login', expiresAt: new Date(Date.now() + 60000).toISOString(),
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    } }));
    await page.route('**/api/accounts/netease/qr/retry-login', (route) => {
      checks += 1;
      if (checks === 1) return route.fulfill({ status: 503, json: { message: 'temporary failure' } });
      connected = true;
      return route.fulfill({ json: { status: 'authorized' } });
    });
    const dialog = await openMigration(page, stream.url, false, () => connected);
    await dialog.getByRole('button', { name: '扫码连接 网易云音乐' }).click();
    await expect(dialog.getByText('检查登录状态暂时失败，正在重试…')).toBeVisible();
    await stream.ready;
    await expect(dialog.getByRole('img', { name: '网易云音乐 登录二维码' })).toHaveCount(0);
    await expect(dialog.getByText('二维码已过期。', { exact: true })).toHaveCount(0);
    expect(checks).toBe(2);
    stream.progress('done', 1, 1, 100);
    stream.event({ type: 'result', result: { platform: 'netease', name: 'test',
      url: 'https://music.163.com/#/playlist?id=101', added: 2, failed: 0, skipped: 0 } });
    stream.end();
    await expect(dialog.getByText('迁移处理完成')).toBeVisible();
  } finally { stream.close(); }
});

test('real streamed progress stays visible across closing, then completes after verification', async ({ page }) => {
  const stream = await progressServer();
  try {
    const dialog = await openMigration(page, stream.url);
    await stream.ready;
    const bar = dialog.getByRole('progressbar', { name: '迁移进度' });
    await expect(bar).toHaveAttribute('aria-valuenow', '0');
    stream.progress('resolving', 1, 2, 50);
    await expect(bar).toHaveAttribute('aria-valuenow', '50');
    await expect(dialog.getByText('正在查找目标歌曲')).toBeVisible();
    await expect(dialog.getByText('已处理 1 / 2 首')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '断开账号' })).toBeDisabled();
    await expect(bar.locator('span')).toHaveCSS('transform', 'matrix(0.5, 0, 0, 1, 0, 0)');
    await page.screenshot({ path: '/tmp/dukou-push-progress-desktop.png' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: '/tmp/dukou-push-progress-mobile.png' });
    expect(await bar.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(375);
    await dialog.getByRole('button', { name: '收起，继续迁移' }).click();
    await expect(dialog).toBeHidden();
    stream.progress('writing', 2, 2, 90);
    await page.getByRole('button', { name: /迁移/ }).click();
    await expect(bar).toHaveAttribute('aria-valuenow', '90');
    expect(stream.count()).toBe(1);
    stream.progress('verifying', 2, 2, 99);
    await expect(bar).toHaveAttribute('aria-valuenow', '99');
    await expect(dialog.getByText('正在核对歌单')).toBeVisible();
    stream.progress('done', 1, 1, 100);
    stream.event({ type: 'result', result: { platform: 'netease', name: '深夜渡口 · 渡口',
      url: 'https://music.163.com/#/playlist?id=101', added: 2, failed: 0, skipped: 0 } });
    stream.end();
    await expect(bar).toHaveAttribute('aria-valuenow', '100');
    await expect(dialog.getByText('迁移处理完成')).toBeVisible();
    await expect(dialog.getByText('已写入 2 首。', { exact: true })).toBeVisible();
  } finally { stream.close(); }
});

test('a saved partial match is reused; re-matching is an explicit action', async ({ page }) => {
  const stream = await progressServer();
  let reMatches = 0;
  try {
    await page.route('**/api/playlists/*', async (route) => {
      const response = await route.fetch();
      const detail = await response.json();
      const items = Array.from({ length: 117 }, (_, i) => ({ ...detail.items[0], id: `song-${i}`, position: i,
        sourcePlatform: 'qq', matches: [{ platform: 'netease', status: i < 94 ? 'matched' : 'missing',
          remoteId: i < 94 ? String(i + 1) : null, source: 'auto', score: i < 94 ? 1 : 0 }] }));
      await route.fulfill({ json: { ...detail, title: 'mp4', sourcePlatform: 'qq', itemCount: 117,
        items, matches: { netease: 94 } } });
    });
    await page.route('**/api/playlists/*/match', async (route) => {
      reMatches += 1;
      expect(route.request().postDataJSON().platform).toBe('netease');
      await route.fulfill({ json: { platform: 'netease', total: 117, matched: 94, message: '匹配完成。' } });
    });
    const dialog = await openMigration(page, stream.url, false);
    await expect(dialog.getByText('已匹配 94', { exact: true })).toBeVisible();
    await expect(dialog.getByText('沿用已有匹配', { exact: true })).toBeVisible();
    await expect(dialog.getByText('23 首未匹配，将跳过')).toBeVisible();
    await expect(dialog.getByText('写入前自动匹配')).toHaveCount(0);
    await page.screenshot({ path: '/tmp/dukou-reuse-matches-desktop.png' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: '/tmp/dukou-reuse-matches-mobile.png' });
    await dialog.getByRole('button', { name: /一键迁移/ }).click();
    await stream.ready;
    stream.progress('resolving', 0, 94, 35);
    await expect(dialog.getByText('正在查找目标歌曲')).toBeVisible();
    expect(reMatches).toBe(0);
    stream.progress('done', 1, 1, 100);
    stream.event({ type: 'result', result: { platform: 'netease', name: 'mp4 · 渡口',
      url: 'https://music.163.com/#/playlist?id=101', added: 94, skipped: 23, failed: 0 } });
    stream.end();
    await expect(dialog.getByText('已写入 94 首，跳过 23 首。', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '重新匹配', exact: true }).click();
    await expect.poll(() => reMatches).toBe(1);
  } finally { stream.close(); }
});

test('an interrupted migration keeps the last real percentage and shows the error', async ({ page }) => {
  const stream = await progressServer();
  try {
    const dialog = await openMigration(page, stream.url);
    await stream.ready;
    stream.progress('writing', 1, 2, 80);
    stream.event({ type: 'error', status: 502, message: '平台暂时不可用，请稍后重试。' });
    stream.end();
    await expect(dialog.getByText('平台暂时不可用，请稍后重试。')).toBeVisible();
    await expect(dialog.getByText('迁移未完成')).toBeVisible();
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
    await expect(dialog.getByRole('button', { name: /一键迁移/ })).toBeEnabled();
  } finally { stream.close(); }
});

test('verification failure keeps the created playlist link and avoids a second submission', async ({ page }) => {
  const stream = await progressServer();
  try {
    const dialog = await openMigration(page, stream.url);
    await stream.ready;
    stream.progress('verifying', 0, 2, 90);
    stream.event({ type: 'result', result: { platform: 'netease', name: '深夜渡口 · 渡口',
      url: 'https://music.163.com/#/playlist?id=101', added: 0, unverified: 2, failed: 0, skipped: 0,
      warning: '2 首已提交但暂时无法核对，请打开目标歌单确认，避免重复迁移。' } });
    stream.end();
    await expect(dialog.getByText('已提交，待核对', { exact: true })).toBeVisible();
    await expect(dialog.getByText('已确认 0 首，2 首待核对。', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '90');
    await expect(dialog.getByRole('link', { name: '打开「深夜渡口 · 渡口」' }))
      .toHaveAttribute('href', 'https://music.163.com/#/playlist?id=101');
    await expect(dialog.getByRole('button', { name: '已提交，请先核对' })).toBeDisabled();
    expect(stream.count()).toBe(1);
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: /迁移/ }).click();
    await expect(dialog.getByText('已提交，待核对', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '已提交，请先核对' })).toBeDisabled();
    const targets = dialog.getByRole('group', { name: '目标平台' });
    await targets.getByRole('button', { name: 'QQ 音乐' }).click();
    await targets.getByRole('button', { name: '网易云音乐' }).click();
    await expect(dialog.getByRole('button', { name: '已提交，请先核对' })).toBeDisabled();
    await page.route('**/api/playlists/*/match', (route) => route.fulfill({
      json: { platform: 'netease', total: 2, matched: 2, message: '匹配完成。' },
    }));
    await dialog.getByRole('button', { name: '重新匹配', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '重新匹配', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: '已提交，请先核对' })).toBeDisabled();
    expect(stream.count()).toBe(1);
    await page.screenshot({ path: '/tmp/dukou-push-unverified.png' });
  } finally { stream.close(); }
});

test('disconnecting ends a pending review and a new login can migrate again', async ({ page }) => {
  const stream = await progressServer();
  let connected = true;
  let releaseDisconnect!: () => void;
  const disconnectGate = new Promise<void>((done) => { releaseDisconnect = done; });
  try {
    await page.route('**/api/accounts/netease', async (route) => {
      await disconnectGate;
      connected = false;
      return route.fulfill({ json: { ok: true } });
    });
    await page.route('**/api/accounts/netease/qr', (route) => route.fulfill({ json: {
      platform: 'netease', key: 'new-login', expiresAt: new Date(Date.now() + 60000).toISOString(),
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      url: 'https://music.163.com/test-only/qr',
    } }));
    await page.route('**/api/accounts/netease/qr/new-login', (route) => {
      connected = true;
      return route.fulfill({ json: { status: 'authorized' } });
    });
    const dialog = await openMigration(page, stream.url, true, () => connected);
    await stream.ready;
    stream.progress('verifying', 0, 2, 90);
    stream.event({ type: 'result', result: { platform: 'netease', name: '旧账号歌单',
      url: 'https://music.163.com/#/playlist?id=101', added: 0, unverified: 2, failed: 0, skipped: 0 } });
    stream.end();
    await expect(dialog.getByRole('button', { name: '已提交，请先核对' })).toBeDisabled();
    await dialog.getByRole('button', { name: '断开账号', exact: true }).click();
    await expect(dialog.getByRole('group', { name: '目标平台' }).getByRole('button', { name: 'QQ 音乐' })).toBeDisabled();
    releaseDisconnect();
    await dialog.getByRole('button', { name: '扫码连接 网易云音乐', exact: true }).click();
    await expect.poll(() => stream.count()).toBe(2);
    stream.progress('done', 1, 1, 100);
    stream.event({ type: 'result', result: { platform: 'netease', name: '新账号歌单',
      url: 'https://music.163.com/#/playlist?id=102', added: 2, failed: 0, skipped: 0 } });
    stream.end();
    await expect(dialog.getByRole('link', { name: '打开「新账号歌单」' })).toBeVisible();
  } finally { stream.close(); }
});

test('stream parser handles fragmented UTF-8, heartbeat frames and a missing result', async ({ page }) => {
  await page.goto('/login');
  const result = await page.evaluate(async () => {
    const { readPushStream } = await import('/src/lib/push-progress.ts');
    const progress: number[] = [];
    const payload = ': keep-alive\r\n\r\ndata: {"type":"progress","progress":{"percent":35}}\r\n\r\n'
      + 'data: {"type":"result","result":{"name":"渡口歌单"}}\r\n\r\n';
    const bytes = new TextEncoder().encode(payload);
    const body = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    const data = await readPushStream(new Response(body), (value: { percent: number }) => progress.push(value.percent));
    let missing = '';
    try { await readPushStream(new Response('data: {"type":"progress","progress":{"percent":80}}\n\n'), () => {}); }
    catch (error) { missing = (error as Error).message; }
    return { data, progress, missing };
  });
  expect(result.data).toEqual({ name: '渡口歌单' });
  expect(result.progress).toEqual([35]);
  expect(result.missing).toContain('进度连接中断');
});


test('QR profile permission failure shows the actual error and stops polling', async ({ page }) => {
  let checks = 0;
  await page.route('**/api/accounts/netease/qr', (route) => route.fulfill({ json: {
    platform: 'netease', key: 'permission-login', expiresAt: new Date(Date.now() + 300000).toISOString(),
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  } }));
  await page.route('**/api/accounts/netease/qr/permission-login', (route) => {
    checks++;
    return route.fulfill({ status: 502, json: { code: 'NETEASE_PROFILE_FORBIDDEN',
      message: '扫码授权已成功，但网易云拒绝读取此账号资料（301：用户未授权当前接口）。' } });
  });
  const dialog = await openMigration(page, 'http://127.0.0.1/unused', false, () => false);
  await dialog.getByRole('button', { name: '扫码连接 网易云音乐' }).click();
  await expect(dialog.getByText(/扫码授权已成功，但网易云拒绝读取此账号资料/)).toBeVisible();
  await expect(dialog.getByRole('img', { name: '网易云音乐 登录二维码' })).toHaveCount(0);
  await expect(dialog.getByText('二维码已过期。', { exact: true })).toHaveCount(0);
  await page.clock.install();
  await page.clock.fastForward(10000);
  expect(checks).toBe(1);
});
