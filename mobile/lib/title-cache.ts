import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Image, type ImageRef } from 'expo-image';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { artworkUrl, mediaKey, resizeBackdrop, type MediaItem } from './home-catalog';
import { mergeTitleDetails } from './detail-presentation';
import { createPrefetchScheduler, rememberTitleSummary, selectPrefetchTitles, titleQueryOptions } from './title-cache-core';

export { rememberTitleSummary, titleQueryOptions, titleSummaryKey } from './title-cache-core';

const MINUTE = 60 * 1000;
const MAX_INACTIVE_LOGOS = 12;
const LOGO_KEY = ['title-logo'] as const;

export interface TitleLogo {
  image: ImageRef;
  /** Embedded alpha information for optical layout. No second image request. */
  thumbhash?: string;
}

function logoQueryOptions(uri: string | undefined, light: boolean) {
  return queryOptions({
    queryKey: [...LOGO_KEY, uri, light ? 'light' : 'dark'] as const,
    queryFn: async (): Promise<TitleLogo | null> => {
      if (!uri) return null;
      try {
        // The native image loader preserves the aspect ratio and uses its disk
        // cache. ImageRef is immediately renderable by Expo Image on navigation.
        // Tint the native ref during decoding. On iOS, assigning tintColor on
        // the consuming view can occur after a SharedRef is already rendered.
        // The iOS SharedRef setter renders before some view props and can
        // crop a wordmark when the view is resized. Warm the ordinary URI
        // cache too, then render that cached URI on iOS for correct layout.
        if (Platform.OS === 'ios') await Image.prefetch(uri, 'memory-disk');
        const image = await Image.loadAsync(uri, { maxWidth: 1000, maxHeight: 500, tintColor: light ? '#272727' : undefined });
        if (!image || !image.width || !image.height) return null;
        const thumbhash = await Image.generateThumbhashAsync(image).catch(() => undefined);
        return { image, thumbhash };
      } catch {
        return null;
      }
    },
    staleTime: query => query.state.data === null ? 30_000 : Infinity,
    gcTime: 2 * MINUTE,
    retry: false,
    // Native SharedRefs are not serializable and must not be deep-compared.
    structuralSharing: false,
  });
}

function pruneInactiveLogos(client: QueryClient) {
  const inactive = client.getQueryCache().findAll({ queryKey: LOGO_KEY, type: 'inactive' })
    .filter(query => query.state.fetchStatus === 'idle' && query.state.data)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of inactive.slice(MAX_INACTIVE_LOGOS)) {
    // Remove JS ownership of unused native refs. Expo releases them when the
    // last JS reference is collected; never release a ref still used by a view.
    client.removeQueries({ queryKey: query.queryKey, exact: true, type: 'inactive' });
  }
}

export function useTitleLogo(uri: string | undefined): TitleLogo | undefined {
  const client = useQueryClient();
  const { colorScheme } = useColorScheme();
  const validUri = artworkUrl(uri);
  const query = useQuery({ ...logoQueryOptions(validUri, colorScheme !== 'dark'), enabled: !!validUri });
  useEffect(() => { if (query.data) pruneInactiveLogos(client); }, [client, query.data]);
  return query.data ?? undefined;
}

async function warmLogo(client: QueryClient, uri: string | undefined, light: boolean) {
  if (!artworkUrl(uri)) return;
  await client.fetchQuery(logoQueryOptions(uri, light));
  pruneInactiveLogos(client);
}

async function warmBackdrop(client: QueryClient, item: MediaItem) {
  const uri = resizeBackdrop(item.background, 1280) ?? item.poster;
  if (!uri) return;
  // Backdrops are much larger than wordmarks, so prefetch to disk only. The
  // actual artwork view chooses the right decoded resolution when it mounts.
  await client.prefetchQuery({
    queryKey: ['title-backdrop', uri],
    queryFn: async () => {
      if (!(await Image.prefetch(uri, 'disk'))) throw new Error('Artwork unavailable');
      return true;
    },
    staleTime: 15 * MINUTE,
    gcTime: 15 * MINUTE,
    retry: false,
  });
}

async function warmTitle(client: QueryClient, summary: MediaItem, light: boolean) {
  // Catalog logos can already be available before full metadata resolves.
  const [result] = await Promise.allSettled([
    client.fetchQuery(titleQueryOptions(summary.type, summary.id)),
    warmLogo(client, summary.logo, light),
  ]);
  const detail = result.status === 'fulfilled' ? result.value : undefined;
  const item = mergeTitleDetails(summary, detail) ?? summary;
  await Promise.allSettled([
    item.logo !== summary.logo ? warmLogo(client, item.logo, light) : Promise.resolve(),
    warmBackdrop(client, item),
  ]);
}

type PrefetchEntry = { item: MediaItem; light: boolean };
const queues = new WeakMap<QueryClient, ReturnType<typeof createPrefetchScheduler<PrefetchEntry>>>();

export function prefetchTitles(client: QueryClient, items: readonly MediaItem[], limit = 3, light = true): () => void {
  const selected = selectPrefetchTitles(items, limit);
  for (const item of selected) rememberTitleSummary(client, item);
  let queue = queues.get(client);
  if (!queue) {
    queue = createPrefetchScheduler(entry => `${mediaKey(entry.item)}:${entry.light}`, entry => warmTitle(client, entry.item, entry.light));
    queues.set(client, queue);
  }
  return queue(selected.map(item => ({ item, light })));
}

export function useTitlePrefetch(items: readonly MediaItem[], limit = 3) {
  const client = useQueryClient();
  const { colorScheme } = useColorScheme();
  const light = colorScheme !== 'dark';
  const selected = selectPrefetchTitles(items, limit);
  // The visible hero can rerender per state update; only a changed selection or
  // image URL should schedule new work. Most effects settle long before a tap.
  const signature = JSON.stringify(selected.map(item => [mediaKey(item), item.logo, item.background, item.poster]));
  useEffect(() => prefetchTitles(client, selected, limit, light), [client, signature, light]);
}
