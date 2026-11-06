import { existsSync } from 'node:fs';
import { BadGatewayException, Logger } from '@nestjs/common';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page, Request } from 'playwright-core';

export type BrowserQrStatus = 'waiting' | 'scanned' | 'authorized' | 'expired';

export interface BrowserQrSession {
  context: BrowserContext;
  page: Page;
  unikey: string;
  chainId: string;
  status: BrowserQrStatus;
  cookie: string | null;
  expiresAt: number;
  message?: string;
}

const logger = new Logger('NeteaseQrBrowser');
const LOGIN_URL = 'https://music.163.com/#/login';
const KEY_PATH = '/weapi/login/qrcode/unikey';
const POLL_PATH = '/weapi/login/qrcode/client/login';
const QR_LIFETIME_MS = 120_000;

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
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function qrBrowser(): Promise<Browser | null> {
  if (!browserPromise) {
    const launching = (async () => {
      try {
        const browser = await chromium.launch({
          executablePath: executablePath(),
          headless: true,
          timeout: 10_000,
          args: LAUNCH_ARGS,
        });
        browser.on('disconnected', () => {
          if (browserPromise === launching) browserPromise = null;
        });
        return browser;
      } catch (error) {
        logger.warn(`启动 Chromium 失败 (${error instanceof Error ? error.name : 'unknown'})`);
        browserPromise = null;
        return null;
      }
    })();
    browserPromise = launching;
  }
  return browserPromise;
}

export async function closeQrBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  const browser = await pending;
  await browser?.close().catch(() => undefined);
}

function cookieHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens music.163.com, asks the official page for a QR key, and leaves the page
 * running so its own polling keeps the login session alive.
 */
export async function openQrSession(): Promise<BrowserQrSession> {
  const startedAt = Date.now();
  const sessionDeadline = startedAt + 38_000;
  const browser = await qrBrowser();
  if (!browser) {
    throw new BadGatewayException('扫码浏览器启动失败，请检查 Chromium 安装及 CHROME_PATH 配置。');
  }

  let context: BrowserContext | undefined;
  let stage = '创建浏览器页面';
  let navigationFailure: string | undefined;
  let keyResult = '未发起';
  let keyRequestedAt: number | undefined;
  let pollResult = '未发起';
  const pendingScripts = new Map<Request, string>();
  const failedScripts = new Set<string>();
  const remaining = () => Math.max(1, sessionDeadline - Date.now());
  let timeout: NodeJS.Timeout | undefined;

  try {
    context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1280, height: 900 },
    });
    // Closing the context also interrupts a stalled newPage or response body read.
    timeout = setTimeout(() => void context?.close().catch(() => undefined), remaining());
    timeout.unref();
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
      expiresAt: Date.now() + QR_LIFETIME_MS,
    };
    const readAuthorization = async () => {
      if (!['waiting', 'scanned'].includes(session.status)) return;
      const cookies = await session.context.cookies('https://music.163.com').catch(() => []);
      const authenticated = cookies.some((cookie) => cookie.name === 'MUSIC_U' && cookie.value);
      if (session.status === 'expired' || !authenticated) return;
      session.cookie = cookieHeader(cookies);
      session.status = 'authorized';
    };
    // The official page can navigate immediately after confirmation, invalidating the response body.
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) void readAuthorization();
    });
    context.on('close', () => {
      if (session.status !== 'authorized') {
        session.status = 'expired';
        session.message = '扫码会话已关闭，请重新生成二维码。';
      }
    });

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
    page.on('requestfinished', (request) => {
      pendingScripts.delete(request);
      if (new URL(request.url()).pathname === POLL_PATH) void readAuthorization();
    });

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
              session.expiresAt = Date.now() + QR_LIFETIME_MS;
            }
            keyResult = `HTTP ${status}${code}，${key ? '已返回二维码标识' : '缺少二维码标识'}`;
          })
          .catch(() => { keyResult = `HTTP ${status}，响应无法解析为 JSON`; });
        return;
      }
      if (pathname !== POLL_PATH) return;
      pollResult = `HTTP ${status}，${session.chainId ? '已有链路标识' : '缺少链路标识'}`;
      void readAuthorization();
      response
        .json()
        .then(async (body: { code?: number }) => {
          if (session.status === 'authorized' || session.status === 'expired') return;
          if (body?.code === 802 && session.status === 'waiting') {
            session.status = 'scanned';
          }
          if (body?.code === 803) {
            await readAuthorization();
          } else if (![801, 802].includes(Number(body?.code))) {
            session.status = 'expired';
            session.message = '网易云二维码已失效，请重新生成。';
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
      if (session.status === 'expired') break;
      const deadline = keyRequestedAt !== undefined && !session.unikey
        ? Math.min(sessionDeadline, keyRequestedAt + 12_000)
        : sessionDeadline;
      if (Date.now() >= deadline) break;
      await sleep(200);
    }

    if (!session.unikey || !session.chainId || session.status === 'expired') {
      const scriptFailures = [...failedScripts].slice(0, 5).join(', ') || '无';
      const scriptsWaiting = [...new Set(pendingScripts.values())].slice(0, 5).join(', ') || '无';
      logger.warn(
        `官网二维码未就绪，耗时 ${Date.now() - startedAt}ms。取码：${keyResult}。轮询：${pollResult}。脚本失败：${scriptFailures}。脚本待完成：${scriptsWaiting}`,
      );
      if (!session.unikey) {
        throw new BadGatewayException(keyRequestedAt === undefined
          ? '网易云登录组件加载超时，请稍后重试。'
          : '网易云取码接口未能返回二维码，请稍后重试。');
      }
      throw new BadGatewayException('网易云授权轮询尚未就绪，请重新生成二维码。');
    }
    return session;
  } catch (error) {
    await context?.close().catch(() => undefined);
    if (error instanceof BadGatewayException) throw error;
    const reason = navigationFailure ?? (error instanceof Error ? error.name : 'unknown');
    logger.warn(`${stage}失败，耗时 ${Date.now() - startedAt}ms (${reason})`);
    throw new BadGatewayException(stage === '等待网易云登录页响应'
      ? '网易云登录页加载失败，请稍后重试。'
      : '扫码浏览器连接中断，请重新生成二维码。');
  } finally {
    clearTimeout(timeout);
  }
}

export async function closeQrSession(session: BrowserQrSession): Promise<void> {
  await session.context.close().catch(() => undefined);
}
