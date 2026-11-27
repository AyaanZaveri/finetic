import { parseCatalog, type HomeSection, type MediaType } from './home-catalog';
import fixtures from './home-fixtures.json';

const DEFAULT_ORIGIN = 'https://navigator-strm.vercel.app';
const CINEMETA_ORIGIN = 'https://cinemeta-catalogs.strem.io';
const TMDB_FEEDS = ['trending-movies', 'trending-series', 'top-rated-movies', 'top-rated-series', 'netflix-movies', 'netflix-series'] as const;

export type HomeFeed = { sections: HomeSection[]; provider: 'TMDB' | 'Cinemeta' | 'Mixed' | 'Fixture' };

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

function backendOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_NAVIGATOR_API_ORIGIN || DEFAULT_ORIGIN;
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Navigator API must be an HTTPS origin');
  }
  return url.origin;
}

async function tmdbFeed(feed: typeof TMDB_FEEDS[number], signal?: AbortSignal): Promise<HomeSection | null> {
  try {
    const response = await requestJson(`${backendOrigin()}/api/discovery/home?feed=tmdb-${feed}`, signal) as {
      status?: string; section?: { sectionName?: unknown; mediaItems?: unknown };
    };
    const section = response?.section;
    if (response?.status !== 'ready' || typeof section?.sectionName !== 'string') return null;
    const mediaItems = parseCatalog(section.mediaItems, feed.endsWith('movies') ? 'movie' : 'series');
    return mediaItems.length ? { key: `tmdb-${feed}`, sectionName: section.sectionName, mediaItems } : null;
  } catch { return null; }
}

async function cinemetaFeed(type: MediaType, signal?: AbortSignal): Promise<HomeSection | null> {
  try {
    const response = await requestJson(`${CINEMETA_ORIGIN}/top/catalog/${type}/top.json`, signal) as { metas?: unknown };
    const mediaItems = parseCatalog(response?.metas, type);
    return mediaItems.length ? { key: `cinemeta-${type}`, sectionName: type === 'movie' ? 'Popular movies' : 'Popular TV shows', mediaItems } : null;
  } catch { return null; }
}

export async function loadHome(signal?: AbortSignal): Promise<HomeFeed> {
  if (process.env.EXPO_PUBLIC_MOBILE_FIXTURES === '1') {
    return { provider: 'Fixture', sections: fixtures.map(row => ({ ...row, mediaItems: parseCatalog(row.mediaItems) })) };
  }
  const [movies, series] = await Promise.all([tmdbFeed(TMDB_FEEDS[0], signal), tmdbFeed(TMDB_FEEDS[1], signal)]);
  if (signal?.aborted) throw new Error('Catalog request cancelled');
  const [fallbackMovies, fallbackSeries, ...additional] = await Promise.all([
    movies ? Promise.resolve(null) : cinemetaFeed('movie', signal),
    series ? Promise.resolve(null) : cinemetaFeed('series', signal),
    ...(movies || series ? TMDB_FEEDS.slice(2).map(feed => tmdbFeed(feed, signal)) : []),
  ]);
  if (signal?.aborted) throw new Error('Catalog request cancelled');
  const sections = [movies ?? fallbackMovies, series ?? fallbackSeries, ...additional].filter((section): section is HomeSection => section !== null);
  if (!sections.length) throw new Error('No catalogs are available. Try again.');
  const hasTMDB = !!movies || !!series || additional.some(Boolean);
  const hasCinemeta = !!fallbackMovies || !!fallbackSeries;
  return { sections, provider: hasTMDB ? hasCinemeta ? 'Mixed' : 'TMDB' : 'Cinemeta' };
}
