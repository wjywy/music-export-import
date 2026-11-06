import { mapLimit } from '../common/concurrency';
import type { OpenApiRecords } from './netease-openapi.client';

/** Resolve saved song IDs, independently of whether this app may play them. */
export async function resolveNeteaseSongIds(
  wanted: ReadonlyMap<string, { title: string; artist: string }>,
  search: (keyword: string) => Promise<OpenApiRecords>,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const queries = new Map<string, Promise<void>>();
  let failure: unknown;
  const lookup = (keyword: string): Promise<void> => {
    const existing = queries.get(keyword);
    if (existing) return existing;
    const query = search(keyword).then((data) => {
      for (const record of data?.records ?? []) {
        const original = String(record.originalId ?? '');
        if (wanted.has(original) && typeof record.id === 'string' && /^[a-f\d]{32}$/i.test(record.id)) {
          resolved.set(original, record.id);
        }
      }
    });
    queries.set(keyword, query);
    return query;
  };

  let completed = 0;
  onProgress?.(0, wanted.size);
  await mapLimit([...wanted], 3, async ([id, hint]) => {
    if (failure) return;
    try {
      if (resolved.has(id)) return;
      const keyword = `${hint.title} ${hint.artist}`.trim();
      await lookup(keyword);
      if (!resolved.has(id) && hint.title.trim() && hint.title.trim() !== keyword) {
        await lookup(hint.title.trim());
      }
    } catch (error) {
      // Drain the other in-flight requests before the owning operation ends.
      failure ??= error;
    } finally {
      onProgress?.(++completed, wanted.size);
    }
  });
  if (failure) throw failure;
  // Response timing must not reorder the destination playlist.
  return new Map([...wanted.keys()].filter((id) => resolved.has(id)).map((id) => [id, resolved.get(id)!]));
}
