import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';

/**
 * NetEase decides whether a QR login may be confirmed by looking at the client
 * that asked for the code key: the same request sent from Node's TLS stack is
 * blocked with "设备环境异常" while the identical request from a real Chromium
 * is accepted. So the key is requested by an actual browser that opens the
 * official login page, and the page keeps polling by itself until the phone
 * confirms — we only read its result.
 */
export type BrowserQrStatus = 'waiting' | 'scanned' | 'authorized';

export interface BrowserQrSession {
  context: BrowserContext;
  page: Page;
  unikey: string;
  chainId: string;
  status: BrowserQrStatus;
  cookie: string | null;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

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
          args: LAUNCH_ARGS,
        });
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      } catch {
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
  const browser = await qrBrowser();
  if (!browser) return null;

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'zh-CN',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

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
          const cookies = await context
            .cookies('https://music.163.com')
            .catch(() => []);
          session.cookie = cookieHeader(cookies) || null;
          session.status = 'authorized';
        }
      })
      .catch(() => undefined);
  });

  try {
    await page.goto('https://music.163.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page
      .locator('a', { hasText: '登录' })
      .first()
      .click({ timeout: 8_000 });
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && !(session.unikey && session.chainId)) {
      await sleep(200);
    }
  } catch {
    await closeQrSession(session);
    return null;
  }

  if (!session.unikey || !session.chainId) {
    await closeQrSession(session);
    return null;
  }
  return session;
}

export async function closeQrSession(session: BrowserQrSession): Promise<void> {
  await session.context.close().catch(() => undefined);
}
