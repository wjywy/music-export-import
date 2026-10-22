export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return '—';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(date);
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function formatCount(count: number): string {
  return new Intl.NumberFormat('zh-CN').format(count);
}

export function splitTrackLine(line: string): { title: string; artist: string } {
  const trimmed = line.trim();
  const separators = [' - ', ' – ', ' — ', '\t', '|'];
  for (const separator of separators) {
    const index = trimmed.indexOf(separator);
    if (index > 0) {
      return {
        artist: trimmed.slice(0, index).trim(),
        title: trimmed.slice(index + separator.length).trim(),
      };
    }
  }
  return { title: trimmed, artist: '' };
}
