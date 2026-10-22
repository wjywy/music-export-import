import { expect, test } from '@playwright/test';

test('landing only presents QQ and NetEase migration', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/渡口/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('渡到对岸');
  await expect(page.getByText('QQ 音乐').first()).toBeVisible();
  await expect(page.getByText('网易云音乐').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /开始迁移/ }).first()).toBeVisible();
  await expect(page.getByText('酷狗')).toHaveCount(0);
  await expect(page.getByText('Apple Music')).toHaveCount(0);
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
  await expect(dialog.getByText('文本格式')).toHaveCount(0);
  await expect(dialog.getByText('复制全部')).toHaveCount(0);
});
