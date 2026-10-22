import { Injectable } from '@nestjs/common';
import { Platform } from '../common/platforms';
import { PlatformError } from '../common/platform-error';
import { SearchHit } from './adapter.interface';
import { PlatformRegistry } from './registry.service';

export interface MatchInput {
  title: string;
  artist: string;
  durationMs?: number | null;
}

export interface MatchOutcome {
  hit: SearchHit | null;
  score: number;
}

const ARTIST_SEPARATORS = /\s*(?:\/|、|&|,|，|feat\.?|ft\.?|with)\s*/gi;

export function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_·•'’"“”《》「」『』()（）[\]【】]/g, '')
    .trim();
}

export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) ?? 0;
    if (count > 0) {
      pairs.set(pair, count - 1);
      overlap += 1;
    }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

function artistScore(a: string, b: string): number {
  const left = normalize(a).split(ARTIST_SEPARATORS).filter(Boolean);
  const right = normalize(b).split(ARTIST_SEPARATORS).filter(Boolean);
  if (!left.length || !right.length) return 0.4;
  let best = 0;
  for (const one of left) {
    for (const two of right) {
      if (!one || !two) continue;
      const direct = one === two ? 1 : one.includes(two) || two.includes(one) ? 0.86 : 0;
      best = Math.max(best, direct, diceCoefficient(one, two));
    }
  }
  return best;
}

function durationScore(a?: number | null, b?: number | null): number {
  if (!a || !b) return 0.5;
  const diff = Math.abs(a - b);
  if (diff <= 3000) return 1;
  if (diff >= 15000) return 0;
  return 1 - (diff - 3000) / 12000;
}

export function scoreCandidate(item: MatchInput, hit: SearchHit): number {
  const title = diceCoefficient(normalize(item.title), normalize(hit.title));
  const artist = artistScore(item.artist, hit.artist);
  const duration = durationScore(item.durationMs, hit.durationMs);
  return Number((title * 0.6 + artist * 0.3 + duration * 0.1).toFixed(4));
}

@Injectable()
export class MatchingService {
  constructor(private readonly registry: PlatformRegistry) {}

  async best(platform: Platform, item: MatchInput, threshold = 0.7): Promise<MatchOutcome> {
    const adapter = this.registry.get(platform);
    const queries = [`${item.title} ${item.artist}`.trim()];
    if (normalize(item.title) && normalize(item.title) !== normalize(queries[0])) {
      queries.push(item.title);
    }

    let best: SearchHit | null = null;
    let bestScore = 0;
    for (const query of queries) {
      const hits = await adapter.search(query, 8);
      for (const hit of hits) {
        const score = scoreCandidate(item, hit);
        if (score > bestScore) {
          best = hit;
          bestScore = score;
        }
      }
      if (bestScore >= Math.max(threshold, 0.9)) break;
    }
    return { hit: bestScore >= threshold ? best : null, score: bestScore };
  }

  async probe(platform: Platform): Promise<void> {
    const adapter = this.registry.get(platform);
    try {
      await adapter.search('晴天 周杰伦', 1);
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      throw new PlatformError('UNAVAILABLE', '目标平台暂时不可用，请稍后重试。');
    }
  }
}
