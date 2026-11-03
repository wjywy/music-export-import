import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';

export type BrowserQrStatus = 'waiting' | 'scanned' | 'authorized';

export interface BrowserQrSession {
  context: BrowserContext;
  page: Page;
  unikey: string;
  chainId: string;
  status: BrowserQrStatus;
  cookie: string | null;
}

const logger = new Logger('NeteaseQrBrowser');
const LOGIN_URL = 'https://music.163.com/';

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-background-timer-throttling',
];

let browserPromise: Promise<Browser | null> | null = null;

function executablePath(): string | undefined {
  const fromEnv = process.env.CHROME_PATH?.trim();
  if (fromEnv) return fromEnv;
  for (const candidate of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/opt/google/chrome/chrome',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function qrBrowser(): Promise<Browser | null> {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const browser = await chromium.launch({
          executablePath: executablePath(),
          headless: true,
          timeout: 10_000,
          args: LAUNCH_ARGS,
        });
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      } catch (error) {
        logger.warn(`启动 Chromium 失败 (${error instanceof Error ? error.name : 'unknown'})`);
        browserPromise = null;
        return null;
      }
    })();
  }
  return browserPromise;
}

function cookieHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens music.163.com, asks the official page for a QR key, and leaves the page
 * running so its own polling keeps the login session alive.
 */
export async function openQrSession(): Promise<BrowserQrSession | null> {
  const startedAt = Date.now();
  const browser = await qrBrowser();
  if (!browser) return null;

  let context: BrowserContext | undefined;
  let stage = '创建浏览器页面';
  let navigationFailure: string | undefined;
  const remaining = () => Math.max(1, 38_000 - (Date.now() - startedAt));

  try {
    context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(remaining());
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      return ['image', 'media', 'font'].includes(type) ? route.abort() : route.continue();
    });
    page.on('requestfailed', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        navigationFailure = request.failure()?.errorText;
      }
    });

    const session: BrowserQrSession = {
      context,
      page,
      unikey: '',
      chainId: '',
      status: 'waiting',
      cookie: null,
    };

    page.on('request', (request) => {
      const chainId = request.headers()['x-login-chain-id'];
      if (chainId && !session.chainId) session.chainId = chainId;
    });

    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/weapi/login/qrcode/unikey')) {
        response
          .json()
          .then((body: { unikey?: string }) => {
            if (body?.unikey && !session.unikey) session.unikey = body.unikey;
          })
          .catch(() => undefined);
        return;
      }
      if (!url.includes('/weapi/login/qrcode/client/login')) return;
      response
        .json()
        .then(async (body: { code?: number }) => {
          if (body?.code === 802 && session.status === 'waiting') {
            session.status = 'scanned';
          }
          if (body?.code === 803) {
            const cookies = await session.context
              .cookies('https://music.163.com')
              .catch(() => []);
            session.cookie = cookieHeader(cookies) || null;
            session.status = 'authorized';
          }
        })
        .catch(() => undefined);
    });

    stage = '等待网易云首页响应';
    const response = await page.goto(LOGIN_URL, {
      waitUntil: 'commit',
      timeout: Math.min(20_000, remaining()),
    });
    if (!response?.ok()) {
      throw new Error(`HTTP ${response?.status() ?? 'unknown'}`);
    }
    stage = '打开登录入口';
    await page
      .locator('a', { hasText: '登录' })
      .first()
      .click({ timeout: Math.min(8_000, remaining()) });
    stage = '等待官网二维码';
    const deadline = Date.now() + Math.min(12_000, remaining());
    while (Date.now() < deadline && !(session.unikey && session.chainId)) {
      await sleep(200);
    }

    if (!session.unikey || !session.chainId) throw new Error('missing QR session');
    return session;
  } catch (error) {
    const reason = navigationFailure ?? (error instanceof Error ? error.name : 'unknown');
    logger.warn(`${stage}失败，耗时 ${Date.now() - startedAt}ms (${reason})`);
    await context?.close().catch(() => undefined);
    return null;
  }
}

export async function closeQrSession(session: BrowserQrSession): Promise<void> {
  await session.context.close().catch(() => undefined);
}
