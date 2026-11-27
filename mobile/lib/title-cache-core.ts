import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { mergeTitleDetails } from './detail-presentation';
import { loadTitle } from './home-api';
import { mediaKey, validMediaId, type MediaItem, type MediaType } from './home-catalog';

const MINUTE = 60 * 1000;

// IMDb and TMDB IDs already occupy distinct namespaces. Share exactly the same
// keys between hero, search, prefetch and detail regardless of the active tab.
export function titleSummaryKey(type: MediaType, id: string) {
  return ['title-summary', type, id] as const;
}

export function titleQueryOptions(type: MediaType, id: string) {
  return queryOptions({
    queryKey: ['title', type, id] as const,
    queryFn: ({ signal }) => loadTitle(type, id, signal),
    staleTime: 5 * MINUTE,
    gcTime: 15 * MINUTE,
    retry: false,
  });
}

export function rememberTitleSummary(client: QueryClient, item: MediaItem) {
  if (!validMediaId(item.id)) return;
  client.setQueryData<MediaItem>(titleSummaryKey(item.type, item.id), previous => mergeTitleDetails(previous, item));
}

export function selectPrefetchTitles(items: readonly MediaItem[], limit: number): MediaItem[] {
  const seen = new Set<string>();
  const result: MediaItem[] = [];
  for (const item of items) {
    const key = mediaKey(item);
    if (result.length >= limit) break;
    if (!validMediaId(item.id) || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Share a small background queue across tabs. Unmounted callers can remove
 * their pending work, but started work can still benefit the detail route. */
export function createPrefetchScheduler<T>(keyFor: (item: T) => string, run: (item: T) => Promise<void>, concurrency = 2) {
  const pending = new Map<string, { item: T; users: number }>();
  const running = new Set<string>();

  function pump() {
    while (running.size < concurrency && pending.size) {
      const [key, { item }] = pending.entries().next().value!;
      pending.delete(key);
      running.add(key);
      void Promise.resolve().then(() => run(item)).catch(() => {}).finally(() => {
        running.delete(key);
        pump();
      });
    }
  }

  return (items: readonly T[]) => {
    const entries = new Map<string, { item: T; users: number }>();
    for (const item of items) {
      const key = keyFor(item);
      if (running.has(key) || entries.has(key)) continue;
      const entry = pending.get(key) ?? { item, users: 0 };
      entry.users++;
      pending.set(key, entry);
      entries.set(key, entry);
    }
    pump();
    return () => {
      for (const [key, entry] of entries) {
        if (pending.get(key) === entry && --entry.users === 0) pending.delete(key);
      }
    };
  };
}
