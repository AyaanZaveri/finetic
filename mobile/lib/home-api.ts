import { parseCatalog, parseMedia, validMediaId, type HomeSection, type MediaItem, type MediaType } from './home-catalog';

const CINEMETA = 'https://v3-cinemeta.strem.io';
const CATALOGS = 'https://cinemeta-catalogs.strem.io/top';
export type HomeFeed = { sections: HomeSection[]; provider: 'Cinemeta' };

async function requestJson(url: string, parent?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(onAbort, 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error('Catalog unavailable');
    return await response.json();
  } finally {
    clearTimeout(timeout);
    parent?.removeEventListener('abort', onAbort);
  }
}

async function catalog(type: MediaType, search?: string, signal?: AbortSignal): Promise<MediaItem[]> {
  const path = `/catalog/${type}/top${search ? `/search=${encodeURIComponent(search)}` : ''}.json`;
  let response: { metas?: unknown };
  try {
    response = await requestJson(`${CINEMETA}${path}`, signal) as { metas?: unknown };
  } catch (error) {
    if (search || signal?.aborted) throw error;
    response = await requestJson(`${CATALOGS}${path}`, signal) as { metas?: unknown };
  }
  if (!Array.isArray(response?.metas)) throw new Error('Catalog unavailable');
  return parseCatalog(response.metas, type);
}

export async function loadHome(signal?: AbortSignal): Promise<HomeFeed> {
  const types = ['movie', 'series'] as const;
  const results = await Promise.allSettled(types.map(type => catalog(type, undefined, signal)));
  if (signal?.aborted) throw new Error('Catalog request cancelled');
  const sections = results.flatMap((result, index) => result.status === 'fulfilled' && result.value.length ? [{
    key: `cinemeta-${types[index]}`,
    sectionName: types[index] === 'movie' ? 'Popular movies' : 'Popular TV shows',
    mediaItems: result.value,
  }] : []);
  if (!sections.length) throw new Error('No catalogs are available. Try again.');
  return { sections, provider: 'Cinemeta' };
}

export async function loadTitle(type: MediaType, id: string, signal?: AbortSignal): Promise<MediaItem> {
  if (!validMediaId(id)) throw new Error('Invalid title.');
  const response = await requestJson(`${CINEMETA}/meta/${type}/${id}.json`, signal) as { meta?: unknown };
  const item = parseMedia(response?.meta, type);
  if (!item || item.id !== id) throw new Error('Title metadata is unavailable.');
  return item;
}

export async function searchTitles(query: string, signal?: AbortSignal): Promise<MediaItem[]> {
  const q = query.trim();
  if (!q) return [];
  const catalogs = await Promise.allSettled((['movie', 'series'] as const).map(type => catalog(type, q, signal)));
  if (signal?.aborted) throw new Error('Search cancelled');
  if (catalogs.every(result => result.status === 'rejected')) throw new Error('Search is unavailable');
  const [movies, series] = catalogs.map(result => result.status === 'fulfilled' ? result.value : []);
  return Array.from({ length: Math.max(movies.length, series.length) }, (_, i) => [movies[i], series[i]]).flat().filter(Boolean);
}
