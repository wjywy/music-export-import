import { expect, test } from '@playwright/test';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');
}

test('mobile H5 callback exchanges code once and removes it from the URL', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  let calls = 0;
  await page.route('**/api/accounts/netease/oauth/complete', (route) => {
    calls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ state: 'a'.repeat(30), code: 'test+code/=' });
    return route.fulfill({ json: { status: 'authorized', nickname: '授权测试', returnTo: '/app' } });
  });
  await page.goto(`/app/netease-callback?state=${'a'.repeat(30)}&code=${encodeURIComponent('test+code/=')}`);
  await expect(page.getByRole('heading', { name: '网易云音乐已连接' })).toBeVisible();
  await expect(page.getByText('已连接：授权测试')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/netease-callback$/);
  expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/dukou-h5-callback-mobile.png', fullPage: true });
  await page.getByRole('link', { name: '返回我的歌单', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test('H5 callback shows permission denial without claiming a successful connection', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/accounts/netease/oauth/complete', (route) => route.fulfill({ status: 502,
    json: { message: '当前网易云应用未获准调用授权码换取令牌接口（300），请向网易云确认 H5 授权权限。' } }));
  await page.goto(`/app/netease-callback?state=${'b'.repeat(30)}&code=test`);
  await expect(page.getByRole('heading', { name: '未能完成连接' })).toBeVisible();
  await expect(page.getByText(/当前网易云应用未获准调用授权码换取令牌接口/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '网易云音乐已连接' })).toHaveCount(0);
});

test('NetEase import keeps the QR retryable after a transient polling failure', async ({ page }) => {
  await signIn(page);
  let checks = 0;
  const image = await require('../../apps/api/node_modules/qrcode').toDataURL('https://music.163.com/login?codekey=import-test');
  await page.route('**/api/accounts', route => route.fulfill({ json: { accounts: [
    { platform: 'netease', connected: false, nickname: null }, { platform: 'qq', connected: false },
  ] } }));
  await page.route('**/api/accounts/netease/qr', route => route.fulfill({ json: {
    platform: 'netease', key: 'import-test', image, expiresAt: new Date(Date.now() + 180000).toISOString(),
  } }));
  await page.route('**/api/accounts/netease/qr/import-test', route => {
    checks++;
    return checks === 1 ? route.fulfill({ status: 503, json: { message: 'temporary failure' } })
      : route.fulfill({ json: { status: 'waiting' } });
  });
  await page.goto('/app/import');
  await page.getByPlaceholder('粘贴 QQ 音乐、网易云或 Apple Music 歌单链接').fill('https://music.163.com/playlist?id=123');
  await page.getByRole('button', { name: '读取歌单', exact: true }).click();
  await expect(page.getByText('检查登录状态暂时失败，正在重试…')).toBeVisible();
  await expect(page.getByRole('link', { name: '保存二维码' })).toBeVisible();
  await expect(page.getByText('二维码已过期。', { exact: true })).toHaveCount(0);
  await expect.poll(() => checks).toBe(2);
  await expect(page.getByText('检查登录状态暂时失败，正在重试…')).toHaveCount(0);
});
