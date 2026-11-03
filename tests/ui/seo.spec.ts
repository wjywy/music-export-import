import { expect, test, type Page } from '@playwright/test';

const SITE_URL = 'https://a2a-platform.com/tool/music/';

async function readMeta(page: Page, key: string) {
  return page
    .locator(
      `meta[name="${key}"], meta[property="${key}"]`,
    )
    .first()
    .getAttribute('content');
}

test('landing ships the complete indexable SEO head', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('渡到对岸');

  await expect(page).toHaveTitle(/渡口 Dukou/);
  await expect(page).toHaveTitle(/歌单迁移/);

  const description = await readMeta(page, 'description');
  expect(description).toContain('歌单迁移');
  expect(description!.length).toBeGreaterThan(50);

  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
    'content',
    /index/,
  );
  await expect(page.locator('link[rel="canonical"]').first()).toHaveAttribute(
    'href',
    SITE_URL,
  );
  await expect(page.locator('link[hreflang="zh-CN"]').first()).toHaveAttribute(
    'href',
    SITE_URL,
  );

  await expect(page.locator('meta[property="og:site_name"]').first()).toHaveAttribute(
    'content',
    '渡口 Dukou',
  );
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute(
    'content',
    `${SITE_URL}og-image.png`,
  );
  await expect(page.locator('meta[property="og:image:width"]').first()).toHaveAttribute(
    'content',
    '1200',
  );
  await expect(page.locator('meta[name="twitter:card"]').first()).toHaveAttribute(
    'content',
    'summary_large_image',
  );
});

test('landing structured data matches the visible FAQ', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();

  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  const graph = await page.evaluate(() => {
    const raw = document.getElementById('seo-structured-data')?.textContent ?? '{}';
    return JSON.parse(raw)['@graph'] as Array<Record<string, unknown>>;
  });
  const types = graph.map((node) => node['@type']);
  for (const type of ['Organization', 'WebSite', 'WebPage', 'WebApplication', 'FAQPage']) {
    expect(types).toContain(type);
  }

  const faq = graph.find((node) => node['@type'] === 'FAQPage') as {
    mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
  };
  expect(faq.mainEntity).toHaveLength(6);

  // Every schema question must be rendered on the page.
  for (const entry of faq.mainEntity) {
    await expect(page.getByText(entry.name, { exact: true })).toBeVisible();
  }

  // Structured data must not be duplicated after hydration.
  await expect(page.locator('#seo-structured-data')).toHaveCount(1);
});

test('private routes are noindex and never inherit the landing title', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText('回到渡口');
  await expect(page).toHaveTitle('登录 · 渡口 Dukou');
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
    'content',
    /noindex/,
  );
  await expect(page.locator('link[rel="canonical"]').first()).toHaveAttribute(
    'href',
    `${SITE_URL}login`,
  );

  await page.goto('/register');
  await expect(page).toHaveTitle('创建账号 · 渡口 Dukou');
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
    'content',
    /noindex/,
  );

  await page.goto('/this-route-does-not-exist');
  await expect(page.locator('h1')).toContainText('这条水路走不通');
  await expect(page).toHaveTitle('页面未找到 · 渡口 Dukou');
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
    'content',
    /noindex/,
  );
});

test('SEO files are served for crawlers and social cards', async ({ request }) => {
  // Crawlers that do not execute JavaScript still get a complete home page.
  const shell = await request.get('/');
  expect(shell.status()).toBe(200);
  const html = await shell.text();
  expect(html).toContain('<title>渡口 Dukou');
  expect(html).toContain('rel="canonical"');
  expect(html).toContain('id="seo-structured-data"');
  expect(html).toContain('<noscript>');
  expect(html).toContain('og:image');

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const robotsText = await robots.text();
  expect(robotsText).toContain('Sitemap: https://a2a-platform.com/tool/music/sitemap.xml');
  expect(robotsText).toContain('Disallow: /tool/music/app');

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('<loc>https://a2a-platform.com/tool/music/</loc>');

  const manifest = await request.get('/site.webmanifest');
  expect(manifest.status()).toBe(200);
  const manifestJson = await manifest.json();
  expect(manifestJson.name).toContain('渡口');
  expect(manifestJson.start_url).toBe('.');
  expect(manifestJson.icons.length).toBeGreaterThanOrEqual(2);

  const ogImage = await request.get('/og-image.png');
  expect(ogImage.status()).toBe(200);
  expect(ogImage.headers()['content-type']).toContain('image/png');
});
