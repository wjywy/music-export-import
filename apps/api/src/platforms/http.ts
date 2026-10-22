import { PlatformError } from '../common/platform-error';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

function buildHeaders(headers?: Record<string, string>): Record<string, string> {
  return {
    'user-agent': DEFAULT_UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(headers ?? {}),
  };
}

async function rawFetch(url: string, opts: FetchOptions): Promise<Response> {
  const { timeoutMs = 12_000, headers, ...rest } = opts;
  try {
    return await fetch(url, {
      ...rest,
      headers: buildHeaders(headers as Record<string, string> | undefined),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new PlatformError('UNAVAILABLE', '平台响应超时，请稍后重试。');
    }
    throw new PlatformError('UNAVAILABLE', '连接平台失败，请检查网络后重试。');
  }
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const response = await rawFetch(url, opts);
  if (response.status === 401 || response.status === 403) {
    throw new PlatformError('AUTH_REQUIRED', '该平台要求登录凭证，请在服务端配置 Cookie 后重试。');
  }
  if (response.status === 429) {
    throw new PlatformError('RATE_LIMITED', '请求过于频繁，已被平台限流，请稍后重试。');
  }
  if (!response.ok) {
    throw new PlatformError('UNAVAILABLE', `平台返回 ${response.status}，请稍后重试。`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PlatformError('UNAVAILABLE', '平台返回的内容无法解析，可能需要登录凭证。');
  }
}

export async function resolveRedirect(url: string): Promise<string> {
  const response = await rawFetch(url, { redirect: 'follow' });
  return response.url || url;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 12_000, headers, ...rest } = opts;
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: buildHeaders(headers as Record<string, string> | undefined),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new PlatformError('UNAVAILABLE', '平台响应超时，请稍后重试。');
    }
    throw new PlatformError('UNAVAILABLE', '连接平台失败，请检查网络后重试。');
  }
  if (!response.ok) {
    throw new PlatformError('UNAVAILABLE', `平台返回 ${response.status}，请稍后重试。`);
  }
  return response.text();
}
