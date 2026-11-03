import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page, Request } from 'playwright-core';

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
const LOGIN_URL = 'https://music.163.com/#/login';
const KEY_PATH = '/weapi/login/qrcode/unikey';
const POLL_PATH = '/weapi/login/qrcode/client/login';

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
  const sessionDeadline = startedAt + 38_000;
  const browser = await qrBrowser();
  if (!browser) return null;

  let context: BrowserContext | undefined;
  let stage = '创建浏览器页面';
  let navigationFailure: string | undefined;
  let keyResult = '未发起';
  let keyRequestedAt: number | undefined;
  let pollResult = '未发起';
  const pendingScripts = new Map<Request, string>();
  const failedScripts = new Set<string>();
  const remaining = () => Math.max(1, sessionDeadline - Date.now());

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
    const session: BrowserQrSession = {
      context,
      page,
      unikey: '',
      chainId: '',
      status: 'waiting',
      cookie: null,
    };

    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? '请求失败';
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        navigationFailure = failure;
      }
      const host = pendingScripts.get(request);
      if (host) {
        pendingScripts.delete(request);
        failedScripts.add(`${host} ${failure}`);
      }
      const path = new URL(request.url()).pathname;
      if (path === KEY_PATH && !session.unikey) keyResult = failure;
      if (path === POLL_PATH) pollResult = failure;
    });
    page.on('requestfinished', (request) => pendingScripts.delete(request));

    page.on('request', (request) => {
      const { hostname, pathname } = new URL(request.url());
      if (request.resourceType() === 'script' && hostname) {
        pendingScripts.set(request, hostname);
      }
      if (pathname === KEY_PATH && !session.unikey) {
        keyRequestedAt ??= Date.now();
        keyResult = '已发起，等待响应';
      }
      if (pathname === POLL_PATH) {
        const chainId = request.headers()['x-login-chain-id'];
        if (chainId && !session.chainId) session.chainId = chainId;
        pollResult = chainId ? '已发起，带链路标识' : '已发起，缺少链路标识';
      }
    });

    page.on('response', (response) => {
      const { hostname, pathname } = new URL(response.url());
      const status = response.status();
      if (response.request().resourceType() === 'script' && status >= 400) {
        failedScripts.add(`${hostname} HTTP ${status}`);
      }
      if (pathname === KEY_PATH) {
        keyResult = `HTTP ${status}`;
        response
          .json()
          .then((body: { code?: number; unikey?: string; data?: { unikey?: string } }) => {
            const code = Number.isInteger(body?.code) ? `，网易云状态码 ${body.code}` : '';
            const key = body?.data?.unikey ?? body?.unikey;
            if (response.ok() && typeof key === 'string' && key && !session.unikey) {
              session.unikey = key;
            }
            keyResult = `HTTP ${status}${code}，${key ? '已返回二维码标识' : '缺少二维码标识'}`;
          })
          .catch(() => { keyResult = `HTTP ${status}，响应无法解析为 JSON`; });
        return;
      }
      if (pathname !== POLL_PATH) return;
      pollResult = `HTTP ${status}，${session.chainId ? '已有链路标识' : '缺少链路标识'}`;
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

    stage = '等待网易云登录页响应';
    const response = await page.goto(LOGIN_URL, {
      waitUntil: 'commit',
      timeout: Math.min(20_000, remaining()),
    });
    if (!response?.ok()) {
      navigationFailure = `HTTP ${response?.status() ?? 'unknown'}`;
      throw new Error('Unexpected login page response');
    }
    stage = '等待官网二维码';
    // The page may need extra time to initialize before it can send its first request.
    while (!(session.unikey && session.chainId)) {
      const deadline = keyRequestedAt !== undefined && !session.unikey
        ? Math.min(sessionDeadline, keyRequestedAt + 12_000)
        : sessionDeadline;
      if (Date.now() >= deadline) break;
      await sleep(200);
    }

    if (!session.unikey || !session.chainId) {
      const scriptFailures = [...failedScripts].slice(0, 5).join(', ') || '无';
      const scriptsWaiting = [...new Set(pendingScripts.values())].slice(0, 5).join(', ') || '无';
      logger.warn(
        `官网二维码未就绪，耗时 ${Date.now() - startedAt}ms。取码：${keyResult}。轮询：${pollResult}。脚本失败：${scriptFailures}。脚本待完成：${scriptsWaiting}`,
      );
      await closeQrSession(session);
      return null;
    }
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
