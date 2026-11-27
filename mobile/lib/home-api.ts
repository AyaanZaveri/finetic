import { parseCatalog, parseEpisodes, parseMedia, validMediaId, type HomeSection, type MediaEpisode, type MediaItem, type MediaType } from './home-catalog';

import type { MetadataProvider } from './metadata-provider';

const DEFAULT_ORIGIN = 'https://navigator-strm.vercel.app';
const TMDB_FEEDS = ['trending-movies', 'trending-series', 'top-rated-movies', 'top-rated-series', 'netflix-movies', 'netflix-series'] as const;

function backendOrigin() {
  const url = new URL(process.env.EXPO_PUBLIC_NAVIGATOR_API_ORIGIN || DEFAULT_ORIGIN);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Navigator API must be an HTTPS origin');
  return url.origin;
}

const CINEMETA = 'https://v3-cinemeta.strem.io';
const CATALOGS = 'https://cinemeta-catalogs.strem.io/top';
export type HomeFeed = { sections: HomeSection[]; provider: 'Cinemeta' | 'TMDB' };

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

async function loadTMDBHome(signal?: AbortSignal): Promise<HomeFeed> {
  const results = await Promise.allSettled(TMDB_FEEDS.map(async feed => {
    const response = await requestJson(`${backendOrigin()}/api/discovery/home?feed=tmdb-${feed}`, signal) as { status?: string; section?: { sectionName?: unknown; mediaItems?: unknown } };
    if (response.status !== 'ready' || typeof response.section?.sectionName !== 'string') throw new Error('TMDB catalog unavailable');
    return { key: `tmdb-${feed}`, sectionName: response.section.sectionName, mediaItems: parseCatalog(response.section.mediaItems, feed.endsWith('movies') ? 'movie' : 'series') };
  }));
  if (signal?.aborted) throw new Error('Catalog request cancelled');
  const sections = results.flatMap(result => result.status === 'fulfilled' && result.value.mediaItems.length ? [result.value] : []);
  if (!sections.length) throw new Error('TMDB catalogs are unavailable.');
  return { provider: 'TMDB', sections };
}

export async function loadHome(signal?: AbortSignal, provider: MetadataProvider = 'cinemeta'): Promise<HomeFeed> {
  if (provider === 'tmdb') return loadTMDBHome(signal);
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
  const response = id.startsWith('tmdb:')
    ? await requestJson(`${backendOrigin()}/api/discovery/title?${new URLSearchParams({ id, type })}`, signal) as { item?: unknown }
    : await requestJson(`${CINEMETA}/meta/${type}/${id}.json`, signal) as { meta?: unknown };
  const item = parseMedia('item' in response ? response.item : 'meta' in response ? response.meta : undefined, type);
  if (!item || item.id !== id) throw new Error('Title metadata is unavailable.');
  return item;
}

export async function searchTitles(query: string, signal?: AbortSignal, provider: MetadataProvider = 'cinemeta'): Promise<MediaItem[]> {
  const q = query.trim();
  if (!q) return [];
  if (provider === 'tmdb') {
    const response = await requestJson(`${backendOrigin()}/api/search/results?${new URLSearchParams({ q, type: 'all', page: '1' })}`, signal) as { results?: unknown; provider?: string };
    if (response.provider !== 'TMDB' || !Array.isArray(response.results)) throw new Error('TMDB search is unavailable');
    return parseCatalog(response.results);
  }
  const catalogs = await Promise.allSettled((['movie', 'series'] as const).map(type => catalog(type, q, signal)));
  if (signal?.aborted) throw new Error('Search cancelled');
  if (catalogs.every(result => result.status === 'rejected')) throw new Error('Search is unavailable');
  const [movies, series] = catalogs.map(result => result.status === 'fulfilled' ? result.value : []);
  return Array.from({ length: Math.max(movies.length, series.length) }, (_, i) => [movies[i], series[i]]).flat().filter(Boolean);
}


export async function loadSeasonEpisodes(id: string, season: number, signal?: AbortSignal): Promise<MediaEpisode[]> {
  if (!validMediaId(id) || !Number.isSafeInteger(season) || season < 0 || season > 9999) throw new Error('Invalid season.');
  if (!id.startsWith('tmdb:')) {
    return (await loadTitle('series', id, signal)).episodes?.filter(episode => episode.season === season) ?? [];
  }
  const response = await requestJson(`${backendOrigin()}/api/discovery/title?${new URLSearchParams({ id, type: 'series', season: String(season) })}`, signal) as { episodes?: unknown };
  return parseEpisodes(response.episodes, id).filter(episode => episode.season === season);
}


/** Supplement missing age certification without changing the user's catalog provider. */
export async function loadCertification(type: MediaType, id: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!validMediaId(id)) return undefined;
  try {
    const response = await requestJson(`${backendOrigin()}/api/discovery/title?${new URLSearchParams({ id, type, certification: '1' })}`, signal) as { contentRating?: { value?: unknown } };
    return typeof response.contentRating?.value === 'string' ? response.contentRating.value : undefined;
  } catch { return undefined; }
}
