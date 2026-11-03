const COOKIE_ATTRIBUTES = new Set([
  'max-age',
  'expires',
  'path',
  'domain',
  'httponly',
  'secure',
  'samesite',
]);

/**
 * Turn one or more Set-Cookie strings into a Cookie header.
 * Attributes are dropped; later values with the same name win.
 */
export function normalizeCookie(raw: string | string[] | undefined | null): string {
  if (!raw) return '';
  const values = Array.isArray(raw) ? raw : [raw];
  const pairs = new Map<string, string>();

  for (const value of values) {
    for (const part of String(value).split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const name = trimmed.slice(0, separator).trim();
      if (!name || COOKIE_ATTRIBUTES.has(name.toLowerCase())) continue;
      pairs.set(name, trimmed.slice(separator + 1).trim());
    }
  }

  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function cookieValue(raw: string | undefined | null, name: string): string | null {
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator).trim() === name) {
      return trimmed.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

/**
 * The QR the official web login shows: a /st/platform/scanlogin link carrying a
 * chainId. The legacy `music.163.com/login?codekey=` link is what the app opens
 * in its in-app browser, which is where NetEase's risk control blocks the scan.
 */
export function scanLoginUrl(key: string, chainId: string): string {
  const params = new URLSearchParams({
    codekey: key,
    chainId,
    hdw_device: 'web',
    hdw_appid: 'web',
    hitExp: '1',
  });
  return `https://music.163.com/st/platform/scanlogin?${params.toString()}`;
}

/** Mirrors the web client: v1_<sDeviceId|unknown-N>_web_login_<timestamp>. */
export function scanLoginChainId(
  cookie: string,
  timestamp = Date.now(),
  random = Math.random,
): string {
  const deviceId =
    cookieValue(cookie, 'sDeviceId') ?? `unknown-${Math.floor(random() * 1e6)}`;
  return `v1_${deviceId}_web_login_${timestamp}`;
}

/** Code-point safe truncation for playlist names required by each platform. */
export function compactPlaylistName(
  title: string,
  maxChars: number,
  suffix = ' · 渡口',
): string {
  const base = (title.trim() || '歌单').replace(/\s+/g, ' ');
  const suffixChars = Array.from(suffix);
  const budget = Math.max(1, maxChars - suffixChars.length);
  const baseChars = Array.from(base).slice(0, budget).join('').trim();
  return `${baseChars || '歌单'}${suffix}`;
}

export function uniqueNumericIds(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = (value ?? '').trim();
    if (!/^\d{1,20}$/.test(id) || Number(id) <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function neteaseIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const direct = parsed.searchParams.get('id');
    if (direct && /^\d+$/.test(direct)) return direct;
    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '';
    const query = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : null;
    const hashId = query?.get('id');
    if (hashId && /^\d+$/.test(hashId)) return hashId;
    return parsed.pathname.match(/\/song\/(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function qqMidFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const mid = parsed.pathname.match(/\/songDetail\/([A-Za-z0-9]+)/)?.[1];
    return mid ?? null;
  } catch {
    return null;
  }
}
