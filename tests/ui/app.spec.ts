import { expect, test } from '@playwright/test';

test('landing presents QQ / NetEase sources and Apple as a target', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/渡口/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('渡到对岸');
  await expect(page.getByText('QQ 音乐').first()).toBeVisible();
  await expect(page.getByText('网易云音乐').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /开始迁移/ }).first()).toBeVisible();
  await expect(page.getByText('酷狗')).toHaveCount(0);
  await expect(page.getByText('Apple Music').first()).toBeVisible();
});

test('demo account can log in and see seeded playlists', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');
  await expect(page.getByText('深夜渡口')).toBeVisible();
  await expect(page.getByText('通勤路上')).toBeVisible();
  await expect(page.getByRole('link', { name: /导入歌单/ })).toBeVisible();
});

test('import page is a single QQ / NetEase link form', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');

  await page.goto('/app/import');
  await expect(
    page.getByPlaceholder('粘贴 QQ 音乐或网易云歌单链接'),
  ).toBeVisible();
  await expect(page.getByText('批量合并')).toHaveCount(0);
  await expect(page.getByText('酷狗')).toHaveCount(0);
});

test('playlist detail opens the minimal transfer dialog', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');

  await page.getByText('深夜渡口').first().click();
  await page.waitForURL(/\/app\/playlists\//);

  await page.getByRole('button', { name: /迁移/ }).click();
  const dialog = page.getByRole('dialog', { name: '迁移这张歌单' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('写进 QQ 音乐')).toBeVisible();
  const targets = dialog.getByRole('group', { name: '目标平台' });
  await expect(targets.getByRole('button', { name: 'QQ 音乐' })).toBeVisible();
  await expect(targets.getByRole('button', { name: '网易云音乐' })).toBeVisible();
  await expect(targets.getByRole('button', { name: 'Apple Music' })).toBeVisible();
  await targets.getByRole('button', { name: 'Apple Music' }).click();
  await expect(dialog.getByText('免费导入 Apple Music')).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '生成 Apple Music 导入链接' }),
  ).toBeVisible();

  await page.route('**/api/platforms/apple/playlists/*/soundiiz', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        total: 2,
        chunkSize: 200,
        links: [
          {
            index: 1,
            from: 1,
            to: 2,
            trackCount: 2,
            url: 'https://soundiiz.com/go/import-playlist/test',
            expiresAt: 1_900_000_000,
          },
        ],
        note: '导入链接 24 小时内有效。',
      }),
    });
  });
  await dialog
    .getByRole('button', { name: '生成 Apple Music 导入链接' })
    .click();
  await expect(dialog.getByRole('link', { name: /打开 Soundiiz/ })).toBeVisible();

  await dialog.getByText('备用：下载文件用 TuneMyMusic 导入').click();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载 TXT' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.txt$/);
  await expect(dialog.getByText('文本格式')).toHaveCount(0);
  await expect(dialog.getByText('复制全部')).toHaveCount(0);
});

test('Apple Music direct panel opens after server config', async ({ page }) => {
  await page.route('**/api/platforms/apple/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        authorized: false,
        storefront: 'cn',
        developerToken: 'test-token',
      }),
    });
  });

  await page.goto('/login');
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL('**/app');

  await page.getByText('深夜渡口').first().click();
  await page.waitForURL(/\/app\/playlists\//);
  await page.getByRole('button', { name: /迁移/ }).click();

  const dialog = page.getByRole('dialog', { name: '迁移这张歌单' });
  const targets = dialog.getByRole('group', { name: '目标平台' });
  await expect(targets.getByRole('button', { name: 'Apple Music' })).toBeVisible();
  await targets.getByRole('button', { name: 'Apple Music' }).click();
  await expect(dialog.getByText('写进 Apple Music')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '连接 Apple Music' })).toBeVisible();
  await expect(dialog.getByText(/需要有效的 Apple Music 订阅/)).toBeVisible();
});
