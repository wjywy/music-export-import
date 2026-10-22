import { Platform } from '../common/platforms';

export type TransferTarget = 'qq' | 'netease';

export const TRANSFER_TARGETS: TransferTarget[] = ['qq', 'netease'];

export type TransferTextFormat = 'song-singer' | 'singer-song' | 'song-only';

export const TRANSFER_FORMATS: TransferTextFormat[] = [
  'song-singer',
  'singer-song',
  'song-only',
];

export const DEFAULT_TRANSFER_CHUNK = 900;
export const MIN_TRANSFER_CHUNK = 200;
export const MAX_TRANSFER_CHUNK = 2000;

export interface TransferTrackInput {
  title: string;
  artist: string;
  /** True when the track has a matched result on the target platform. */
  matched: boolean;
  matchedTitle?: string | null;
  matchedArtist?: string | null;
}

export interface TransferChunk {
  index: number;
  text: string;
  chars: number;
  trackCount: number;
  fromTrack: number;
  toTrack: number;
}

export interface TransferPlan {
  target: TransferTarget;
  targetName: string;
  source: {
    title: string;
    platform: Platform | null;
    url: string | null;
    itemCount: number;
  };
  format: TransferTextFormat;
  chunkChars: number;
  total: number;
  matched: number;
  chunks: TransferChunk[];
  text: string;
  sourceLink: string | null;
  importUrl: string;
  steps: string[];
  note: string | null;
}

export interface BuildTransferInput {
  target: TransferTarget;
  title: string;
  sourcePlatform: Platform | null;
  sourceUrl: string | null;
  tracks: TransferTrackInput[];
  format?: TransferTextFormat;
  chunkChars?: number;
}

export function isTransferTarget(value: unknown): value is TransferTarget {
  return typeof value === 'string' && (TRANSFER_TARGETS as string[]).includes(value);
}

export function isTransferFormat(value: unknown): value is TransferTextFormat {
  return typeof value === 'string' && (TRANSFER_FORMATS as string[]).includes(value);
}

export function clampChunkChars(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_TRANSFER_CHUNK;
  return Math.min(MAX_TRANSFER_CHUNK, Math.max(MIN_TRANSFER_CHUNK, Math.round(value)));
}

/**
 * Build one line for the target platform's text import.
 * Matched target metadata wins; otherwise the source title/artist is kept.
 */
export function transferLine(
  track: TransferTrackInput,
  format: TransferTextFormat,
): string {
  const title = track.matched && track.matchedTitle ? track.matchedTitle : track.title;
  const artist =
    track.matched && track.matchedArtist ? track.matchedArtist : track.artist;
  const cleanTitle = title.trim() || '未知曲目';
  const cleanArtist = artist.trim();

  if (format === 'song-only' || !cleanArtist) return cleanTitle;
  if (format === 'singer-song') return `${cleanArtist} - ${cleanTitle}`;
  return `${cleanTitle} - ${cleanArtist}`;
}

/**
 * Split lines into chunks without breaking a song line.
 * A single oversized line becomes its own chunk.
 */
export function chunkTransferLines(
  lines: string[],
  maxChars: number,
): Omit<TransferChunk, 'index'>[] {
  const limit = Math.max(1, Math.floor(maxChars));
  const chunks: Omit<TransferChunk, 'index'>[] = [];
  let current: string[] = [];
  let chars = 0;
  let startIndex = 0;

  const flush = (endIndex: number) => {
    const text = current.join('\n');
    chunks.push({
      text,
      chars: text.length,
      trackCount: current.length,
      fromTrack: startIndex + 1,
      toTrack: endIndex,
    });
    current = [];
    chars = 0;
    startIndex = endIndex;
  };

  lines.forEach((line, index) => {
    const extra = current.length === 0 ? line.length : line.length + 1;
    if (current.length > 0 && chars + extra > limit) {
      flush(index);
    }
    current.push(line);
    chars += current.length === 1 ? line.length : line.length + 1;
  });

  if (current.length > 0) flush(lines.length);

  return chunks;
}

function isQQShareLink(platform: Platform | null, url: string | null): string | null {
  if (platform !== 'qq' || !url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)qq\.com$/i.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const TARGET_META: Record<TransferTarget, { name: string; importUrl: string }> = {
  qq: {
    name: 'QQ 音乐',
    importUrl: 'https://y.qq.com/y/static/mymusic/songlist_import.html',
  },
  netease: {
    name: '网易云音乐',
    importUrl: 'https://music.163.com/',
  },
};

export function buildTransferPlan(input: BuildTransferInput): TransferPlan {
  const target = input.target;
  const meta = TARGET_META[target];
  const format = input.format ?? 'song-singer';
  const chunkChars = clampChunkChars(input.chunkChars);
  const total = input.tracks.length;
  const matched = input.tracks.filter((track) => track.matched).length;
  const sourceLink = isQQShareLink(input.sourcePlatform, input.sourceUrl);

  const lines = input.tracks.map((track) => transferLine(track, format));
  const text = lines.join('\n');
  const chunks: TransferChunk[] = chunkTransferLines(lines, chunkChars).map(
    (chunk, index) => ({ ...chunk, index: index + 1 }),
  );

  const notes: string[] = [];
  let steps: string[];

  if (target === 'qq') {
    steps = [
      '打开 QQ 音乐 App，进入「我的 → 更多 → 导入外部歌单」。',
      '选择「链接 / 文字导入」，粘贴第 1 段文本；如果分成多段，逐段导入。',
      '等待 1–2 分钟匹配。曲库里没有的歌会导入失败，属于正常。',
    ];
    if (chunks.length > 1) {
      notes.push(
        `共 ${total} 首，按 ${chunkChars} 字符切成 ${chunks.length} 段。QQ 文字导入单次约 1000 字符，需要在 QQ 音乐里逐段导入后手动合并。`,
      );
    }
    if (matched < total) {
      notes.push(
        `其中 ${total - matched} 首还没有匹配到 QQ 音乐，文本使用原曲名 / 歌手，导入时可能失败。`,
      );
    }
  } else {
    if (sourceLink) {
      steps = [
        '打开网易云音乐 App，进入「我的 → 导入外部歌单」。',
        '粘贴上面的 QQ 音乐歌单链接，点「开始导入」。',
        '等待匹配完成；没有版权的歌会变灰。',
      ];
      notes.push('网易云只接受链接导入；上面是你这张 QQ 音乐歌单的原始链接。');
    } else {
      steps = [
        '网易云只接受链接导入，不能直接粘贴文字。',
        '如果这张歌单来自 QQ 音乐，请回到原歌单复制分享链接，再粘贴到网易云的「导入外部歌单」。',
        '如果它是在渡口新建或合并的，没有可粘贴的原始链接，只能按下方清单逐首搜索，或导出 CSV 后手工整理。',
      ];
      notes.push(
        '这张歌单没有可用的 QQ 音乐原始链接。渡口自建 / 合并的歌单无法通过网易云的链接导入完成迁移。',
      );
    }
  }

  if (chunks.some((chunk) => chunk.chars > chunkChars)) {
    notes.push('有单行超过分段长度，已单独成段；这一行不会被截断。');
  }

  return {
    target,
    targetName: meta.name,
    source: {
      title: input.title,
      platform: input.sourcePlatform,
      url: input.sourceUrl,
      itemCount: total,
    },
    format,
    chunkChars,
    total,
    matched,
    chunks,
    text,
    sourceLink,
    importUrl: meta.importUrl,
    steps,
    note: notes.length ? notes.join(' ') : null,
  };
}
