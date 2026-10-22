import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5280',
    ...(process.env.CI ? {} : { channel: 'chrome' }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command:
        'pnpm --filter @dukou/api db:reset && pnpm --filter @dukou/api seed && pnpm --filter @dukou/api dev',
      url: 'http://127.0.0.1:3100/api/health',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DB_NAME: 'dukou_test',
        PORT: '3100',
        JWT_SECRET: 'playwright-secret',
        CREDENTIALS_SECRET: 'playwright-credential-secret',
        WEB_ORIGIN: 'http://127.0.0.1:5280',
      },
    },
    {
      command:
        'pnpm --filter @dukou/web dev --host 127.0.0.1 --port 5280 --strictPort',
      url: 'http://127.0.0.1:5280',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_PROXY_TARGET: 'http://127.0.0.1:3100',
      },
    },
  ],
});
