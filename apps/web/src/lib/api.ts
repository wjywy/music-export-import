import type {
  AccountPlatform,
  AccountPushResult,
  AccountQr,
  AccountQrStatus,
  AccountStatus,
  AuthResult,
  ImportJob,
  PlaylistDetail,
  PlaylistSummary,
  User,
} from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
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
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, timeoutMs = 30_000, headers, ...rest } = options;
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
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
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

  accounts: () => request<{ accounts: AccountStatus[] }>('/accounts'),
  startAccountQr: (platform: AccountPlatform) =>
    request<AccountQr>(`/accounts/${platform}/qr`, {
      method: 'POST',
      timeoutMs: 45_000,
    }),
  checkAccountQr: (platform: AccountPlatform, key: string) =>
    request<AccountQrStatus>(`/accounts/${platform}/qr/${encodeURIComponent(key)}`, {
      timeoutMs: 20_000,
    }),
  disconnectAccount: (platform: AccountPlatform) =>
    request<{ ok: boolean }>(`/accounts/${platform}`, { method: 'DELETE' }),
  pushPlaylist: (playlistId: string, platform: AccountPlatform) =>
    request<AccountPushResult>(`/playlists/${playlistId}/push`, {
      method: 'POST',
      body: jsonBody({ platform }),
      timeoutMs: 240_000,
    }),
};
