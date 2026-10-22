import type {
  AuthResult,
  Delivery,
  ImportJob,
  Platform,
  PlatformInfo,
  PlaylistDetail,
  PlaylistSummary,
  PublicShare,
  Share,
  SharePermission,
  Stats,
  User,
  Visibility,
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
    request<AuthResult>(
      '/auth/register',
      { method: 'POST', body: jsonBody({ email, password, displayName }), auth: false },
    ),
  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', {
      method: 'POST',
      body: jsonBody({ email, password }),
      auth: false,
    }),
  me: () => request<User>('/auth/me'),

  platforms: () =>
    request<{ platforms: PlatformInfo[]; handlesWrite: boolean; note: string }>(
      '/platforms',
      { auth: false },
    ),
  resolve: (url: string) =>
    request<{ platform: Platform; kind: string; id: string; url: string; name: string }>(
      '/platforms/resolve',
      { method: 'POST', body: jsonBody({ url }) },
    ),

  playlists: () => request<PlaylistSummary[]>('/playlists'),
  stats: () => request<Stats>('/playlists/stats'),
  playlist: (id: string) => request<PlaylistDetail>(`/playlists/${id}`),
  createPlaylist: (input: {
    title: string;
    description?: string | null;
    visibility?: Visibility;
    items?: { title: string; artist?: string; album?: string | null }[];
  }) =>
    request<PlaylistSummary>('/playlists', {
      method: 'POST',
      body: jsonBody(input),
    }),
  updatePlaylist: (
    id: string,
    input: { title?: string; description?: string | null; visibility?: Visibility },
  ) =>
    request<PlaylistDetail>(`/playlists/${id}`, {
      method: 'PATCH',
      body: jsonBody(input),
    }),
  deletePlaylist: (id: string) =>
    request<{ ok: boolean }>(`/playlists/${id}`, { method: 'DELETE' }),
  match: (id: string, platform: Platform, threshold?: number) =>
    request<{ platform: Platform; total: number; matched: number; message: string }>(
      `/playlists/${id}/match`,
      {
        method: 'POST',
        body: jsonBody({ platform, ...(threshold ? { threshold } : {}) }),
        timeoutMs: 180_000,
      },
    ),
  clearMatches: (id: string, platform?: Platform) =>
    request<{ removed: number }>(
      `/playlists/${id}/matches${platform ? `?platform=${platform}` : ''}`,
      { method: 'DELETE' },
    ),
  delivery: (id: string, platform: Platform) =>
    request<Delivery>(`/playlists/${id}/delivery?platform=${platform}`),

  shares: () => request<Share[]>('/shares'),
  createShare: (
    playlistId: string,
    permission: SharePermission,
    expiresInDays?: number,
  ) =>
    request<Share>('/shares', {
      method: 'POST',
      body: jsonBody({ playlistId, permission, expiresInDays }),
    }),
  revokeShare: (id: string) =>
    request<{ ok: boolean }>(`/shares/${id}`, { method: 'DELETE' }),

  imports: () => request<ImportJob[]>('/imports'),
  importJob: (id: string) => request<ImportJob>(`/imports/${id}`),
  createImport: (url: string, targetPlatform?: Platform) =>
    request<ImportJob>('/imports', {
      method: 'POST',
      body: jsonBody({ url, ...(targetPlatform ? { targetPlatform } : {}) }),
      timeoutMs: 60_000,
    }),

  publicShare: (token: string) =>
    request<PublicShare>(`/share/${token}`, { auth: false }),
  cloneShare: (token: string) =>
    request<{ playlistId: string; title: string; itemCount: number }>(
      `/share/${token}/clone`,
      { method: 'POST' },
    ),

  async download(path: string, fallbackName: string): Promise<void> {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new ApiError('导出失败，请稍后再试。', response.status);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const filename = encoded ? decodeURIComponent(encoded) : fallbackName;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  },
};
