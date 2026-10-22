import { expect, test } from '@playwright/test';

test('landing presents the ferry and the transfer preview', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/渡口/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('把歌单');
  await expect(page.getByText('读取、比对、送达。')).toBeVisible();
  await expect(page.getByText('深夜渡口').first()).toBeVisible();
});

test('demo account can log in and see seeded playlists', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');
  await expect(page.getByText('深夜渡口')).toBeVisible();
  await expect(page.getByText('通勤路上')).toBeVisible();
  await expect(page.getByText('雨天旧唱片')).toBeVisible();
});

test('import page switches between single and batch modes', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');

  await page.goto('/app/import');
  await expect(page.getByRole('heading', { name: /把歌单/ })).toBeVisible();
  await page.getByRole('button', { name: '批量合并' }).click();
  await expect(page.getByPlaceholder(/https:\/\/music\.163\.com/)).toBeVisible();
  await expect(page.getByText('0 / 10')).toBeVisible();

  await page.getByRole('button', { name: '单个链接' }).click();
  await expect(page.getByPlaceholder(/粘贴歌单分享链接/)).toBeVisible();
});

test('settings expose Apple Music and KuWo session sections', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Apple Music' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '酷我会话' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '记住的映射' })).toBeVisible();
});

test('shared playlist can be saved by a new account', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/register');
  await page.getByPlaceholder('朋友怎么称呼你').fill('测试听众');
  await page.getByPlaceholder('you@example.com').fill(`pw-${stamp}@dukou.app`);
  await page.getByPlaceholder('至少 8 位').fill('playwright123');
  await page.getByRole('button', { name: '创建账号' }).click();
  await page.waitForURL('**/app');

  await page.goto('/s/demo');
  await expect(page.getByRole('heading', { name: '深夜渡口' })).toBeVisible();
  await page.getByRole('button', { name: '保存到我的歌单' }).click();
  await expect(page.getByText('已保存到你的歌单')).toBeVisible();
  await page.getByRole('link', { name: '打开歌单' }).click();
  await expect(page.getByRole('heading', { name: /深夜渡口/ })).toBeVisible();
});

test('a new playlist can be created from the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');
  await page.getByRole('button', { name: '新建歌单' }).click();
  await page.getByPlaceholder('比如：雨天旧唱片').fill('E2E 新建歌单');
  await page
    .getByPlaceholder('周杰伦 - 晴天')
    .fill('周杰伦 - 晴天\n陈奕迅 - 富士山下');
  await page.getByRole('button', { name: '创建歌单' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 新建歌单' })).toBeVisible();
  await expect(page.getByText('晴天')).toBeVisible();
});
