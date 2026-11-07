import type {
  AccountPlatform,
  AccountQr,
  AccountQrStatus,
  AccountStatus,
  AppleImportLinks,
  ApplePushResult,
  AppleStatus,
  AuthResult,
  ImportJob,
  MatchResult,
  Platform,
  PlaylistDetail,
  PlaylistSummary,
  PushResult,
  PushProgress,
  User,
} from './types';
import { PushStreamError, readPushStream } from './push-progress';

const API_BASE = (
  import.meta.env.VITE_API_BASE ?? `${import.meta.env.BASE_URL}api`
).replace(/\/$/, '');
const TOKEN_KEY = 'dukou.token';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private mode; the in-memory token still works.
  }
}

interface RequestOptions extends RequestInit {
  auth?: boolean;
  timeoutMs?: number;
  onProgress?: (value: PushProgress) => void;
}

export const ACCOUNT_QR_TIMEOUT_SECONDS = 45;

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, timeoutMs = 30_000, headers, signal, onProgress, ...rest } = options;
  const finalHeaders: Record<string, string> = {
    ...(rest.body ? { 'content-type': 'application/json' } : {}),
    ...(headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (auth && token) finalHeaders.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: finalHeaders,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new ApiError('请求超时了，请稍后重试。', 0);
    }
    throw new ApiError('连接不上服务器，请检查网络。', 0);
  }

  if (!response.ok) {
    let payload: { message?: string; code?: string } | null = null;
    try {
      payload = (await response.json()) as { message?: string; code?: string };
    } catch {
      payload = null;
    }
    if (response.status === 401 && auth && token) {
      window.dispatchEvent(new CustomEvent('dukou:unauthorized'));
    }
    throw new ApiError(
      payload?.message ?? `请求失败（${response.status}）。`,
      response.status,
      payload?.code,
    );
  }

  if (response.status === 204) return undefined as T;
  if (onProgress && response.headers.get('content-type')?.includes('text/event-stream')) {
    try {
      return await readPushStream<T>(response, onProgress);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof PushStreamError) {
        if (error.status === 401 && auth && token) window.dispatchEvent(new CustomEvent('dukou:unauthorized'));
        throw new ApiError(error.message, error.status);
      }
      throw new ApiError('进度连接中断，迁移可能仍在进行，请先到目标平台查看歌单。', 0);
    }
  }
  return (await response.json()) as T;
}

function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value);
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<AuthResult>('/auth/register', {
      method: 'POST',
      body: jsonBody({ email, password, displayName }),
      auth: false,
    }),
  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', {
      method: 'POST',
      body: jsonBody({ email, password }),
      auth: false,
    }),
  me: () => request<User>('/auth/me'),

  playlists: () => request<PlaylistSummary[]>('/playlists'),
  playlist: (id: string) => request<PlaylistDetail>(`/playlists/${id}`),
  deletePlaylist: (id: string) =>
    request<{ ok: boolean }>(`/playlists/${id}`, { method: 'DELETE' }),

  createImport: (url: string) =>
    request<ImportJob>('/imports', {
      method: 'POST',
      body: jsonBody({ url }),
      timeoutMs: 60_000,
    }),
  importJob: (id: string) => request<ImportJob>(`/imports/${id}`),

  startNeteaseOAuth: (returnTo: string) => request<{ url: string }>('/accounts/netease/oauth/start', {
    method: 'POST', body: JSON.stringify({ returnTo }),
  }),
  completeNeteaseOAuth: (state: string, code: string) =>
    request<{ status: 'authorized'; nickname: string | null; returnTo: string }>('/accounts/netease/oauth/complete', {
      method: 'POST', body: JSON.stringify({ state, code }),
    }),
  accounts: () => request<{ accounts: AccountStatus[] }>('/accounts'),
  startAccountQr: (platform: AccountPlatform) =>
    request<AccountQr>(`/accounts/${platform}/qr`, {
      method: 'POST',
      timeoutMs: ACCOUNT_QR_TIMEOUT_SECONDS * 1000,
    }),
  checkAccountQr: (platform: AccountPlatform, key: string) =>
    request<AccountQrStatus>(`/accounts/${platform}/qr/${encodeURIComponent(key)}`, {
      timeoutMs: 5000,
    }),
  connectAccountCookie: (platform: AccountPlatform, cookie: string) =>
    request<AccountStatus>(`/accounts/${platform}/cookie`, {
      method: 'POST',
      body: jsonBody({ cookie }),
      timeoutMs: 30_000,
    }),
  disconnectAccount: (platform: AccountPlatform) =>
    request<{ ok: boolean }>(`/accounts/${platform}`, { method: 'DELETE' }),
  pushPlaylist: (playlistId: string, platform: AccountPlatform, onProgress?: (value: PushProgress) => void, signal?: AbortSignal) =>
    request<PushResult>(`/playlists/${playlistId}/push`, {
      method: 'POST',
      body: jsonBody({ platform }),
      timeoutMs: 900_000,
      headers: onProgress ? { accept: 'text/event-stream' } : undefined,
      onProgress,
      signal,
    }),

  matchPlaylist: (playlistId: string, platform: Platform) =>
    request<MatchResult>(`/playlists/${playlistId}/match`, {
      method: 'POST',
      body: jsonBody({ platform }),
      timeoutMs: 900_000,
    }),

  appleConfig: () =>
    request<AppleStatus>('/platforms/apple/config', { timeoutMs: 20_000 }),
  appleAuthorize: (musicUserToken: string) =>
    request<AppleStatus>('/platforms/apple/authorize', {
      method: 'POST',
      body: jsonBody({ musicUserToken }),
      timeoutMs: 30_000,
    }),
  appleDisconnect: () =>
    request<{ ok: boolean }>('/platforms/apple/authorize', {
      method: 'DELETE',
    }),
  applePushPlaylist: (playlistId: string, onProgress?: (value: PushProgress) => void, signal?: AbortSignal) =>
    request<ApplePushResult>(`/platforms/apple/playlists/${playlistId}/push`, {
      method: 'POST',
      timeoutMs: 900_000,
      headers: onProgress ? { accept: 'text/event-stream' } : undefined,
      onProgress,
      signal,
    }),
  appleImportLinks: (playlistId: string) =>
    request<AppleImportLinks>(
      `/platforms/apple/playlists/${playlistId}/soundiiz`,
      {
        method: 'POST',
        timeoutMs: 180_000,
      },
    ),
};
