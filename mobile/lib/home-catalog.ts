export type MediaType = 'movie' | 'series';
export interface MediaEpisode {
  id: string;
  season: number;
  number: number;
  name: string;
  description?: string;
  thumbnail?: string;
  released?: string;
  runtime?: string;
}
export interface MediaItem {
  id: string;
  type: MediaType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  year?: number;
  releaseInfo?: string;
  released?: string;
  contentRating?: string;
  imdbRating?: string;
  communityRating?: number;
  ratingSource?: string;
  genres?: string[];
  runtime?: string;
  cast?: string[];
  director?: string[];
  writer?: string[];
  castMembers?: { id: string; name: string; role?: string; image?: string }[];
  seasons?: { number: number; name: string; episodeCount: number }[];
  episodes?: MediaEpisode[];
}
export interface HomeSection {
  key: string;
  sectionName: string;
  mediaItems: MediaItem[];
}

export const mediaKey = (item: MediaItem) => `${item.type}:${item.id}`;

const TMDB_IMAGE = /^https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\/[\w.-]+\.(?:jpg|jpeg|png|webp|svg)$/i;
const CINEMETA_EPISODE = /^https:\/\/episodes\.metahub\.space\/tt\d+\/\d+\/\d+\/w\d+\.(?:jpg|jpeg|png|webp)$/i;
const CINEMETA_IMAGE = /^https:\/\/images\.metahub\.space\/(?:poster|background|logo)\/(?:small|medium|large|original)\/tt\d+\/img$/i;

export function artworkUrl(value: unknown): string | undefined {
  return typeof value === 'string' && (TMDB_IMAGE.test(value) || CINEMETA_IMAGE.test(value) || CINEMETA_EPISODE.test(value)) ? value : undefined;
}

export function resizeBackdrop(url: string | undefined, width: 780 | 1280 = 780): string | undefined {
  return artworkUrl(url)?.replace(/\/t\/p\/[^/]+\//, `/t/p/w${width}/`);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function releaseYear(item: { year?: unknown; releaseInfo?: unknown }): number | undefined {
  const raw = [item.year, item.releaseInfo].map(value => typeof value === 'string' ? /^\s*(\d{4})/.exec(value)?.[1] : value).find(value => value != null);
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1888 && parsed <= new Date().getFullYear() + 1 ? parsed : undefined;
}

export function validMediaId(id: unknown): id is string {
  return typeof id === 'string' && /^(?:tt\d{1,12}|tmdb:[1-9]\d{0,11})$/.test(id);
}

function parseSeasons(seasons: unknown, videos: unknown): MediaItem['seasons'] {
  if (Array.isArray(seasons)) {
    return seasons.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const { number, name, episodeCount } = value as Record<string, unknown>;
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0 || number > 10000 ||
          typeof episodeCount !== 'number' || !Number.isSafeInteger(episodeCount) || episodeCount < 1) return [];
      return [{ number, name: text(name) ?? (number ? `Season ${number}` : 'Specials'), episodeCount }];
    }).sort((a, b) => a.number - b.number);
  }
  if (!Array.isArray(videos)) return undefined;
  const grouped = new Map<number, Set<number>>();
  for (const video of videos) {
    if (!video || typeof video !== 'object') continue;
    const { season, episode } = video as Record<string, unknown>;
    if (typeof season !== 'number' || !Number.isSafeInteger(season) || season < 0 || season > 10000 ||
        typeof episode !== 'number' || !Number.isSafeInteger(episode) || episode < 1) continue;
    const episodes = grouped.get(season) ?? new Set<number>();
    episodes.add(episode);
    grouped.set(season, episodes);
  }
  return [...grouped.entries()].sort(([a], [b]) => a - b).map(([number, episodes]) => ({ number, name: number ? `Season ${number}` : 'Specials', episodeCount: episodes.size }));
}

export function parseEpisodes(values: unknown, seriesId: string): MediaEpisode[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const season = row.season, number = row.episode ?? row.number;
    if (typeof season !== 'number' || !Number.isSafeInteger(season) || season < 0 || season > 10000 ||
        typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || number > 10000) return [];
    const id = `${seriesId}:${season}:${number}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, season, number, name: text(row.title) ?? text(row.name) ?? `Episode ${number}`,
      description: text(row.description) ?? text(row.overview), thumbnail: artworkUrl(row.thumbnail), released: text(row.released),
      runtime: text(row.runtime) ?? (typeof row.runtime === 'number' && row.runtime > 0 ? `${row.runtime} min` : undefined) }];
  }).sort((a, b) => a.season - b.season || a.number - b.number);
}

export function formatReleaseDate(value?: string, year?: number): string | undefined {
  if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isNaN(date.valueOf())) return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
  }
  return year?.toString();
}

export function parseMedia(value: unknown, expected?: MediaType): MediaItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if ((item.type !== 'movie' && item.type !== 'series') || (expected && item.type !== expected)) return null;
  const id = text(item.id);
  const name = text(item.name);
  if (!validMediaId(id) || !name) return null;
  const rating = typeof item.communityRating === 'number' && item.communityRating > 0 && item.communityRating <= 10 ? item.communityRating : undefined;
  return {
    id, type: item.type, name,
    poster: artworkUrl(item.poster), background: artworkUrl(item.background), logo: artworkUrl(item.logo),
    description: text(item.description), year: releaseYear(item), releaseInfo: text(item.releaseInfo), released: text(item.released),
    contentRating: text(item.contentRating) ?? (item.contentRating && typeof item.contentRating === "object" ? text((item.contentRating as Record<string, unknown>).value) : undefined) ?? text(item.certification),
    imdbRating: text(item.imdbRating), communityRating: rating, ratingSource: text(item.ratingSource),
    genres: Array.isArray(item.genres) ? item.genres.flatMap(value => text(value) ?? []).slice(0, 4) : undefined,
    runtime: text(item.runtime),
    cast: Array.isArray(item.cast) ? item.cast.flatMap(value => text(value) ?? []).slice(0, 30) : undefined,
    director: Array.isArray(item.director) ? item.director.flatMap(value => text(value) ?? []) : undefined,
    writer: Array.isArray(item.writer) ? item.writer.flatMap(value => text(value) ?? []) : undefined,
    castMembers: Array.isArray(item.castMembers) ? item.castMembers.flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const member = value as Record<string, unknown>;
      const id = text(member.id), name = text(member.name);
      return id && name ? [{ id, name, role: text(member.role), image: artworkUrl(member.image) }] : [];
    }).slice(0, 30) : undefined,
    seasons: item.type === 'series' ? parseSeasons(item.seasons, item.videos) : undefined,
    episodes: item.type === 'series' ? parseEpisodes(item.videos ?? item.episodes, id) : undefined,
  };
}

export function parseCatalog(values: unknown, type?: MediaType): MediaItem[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values.flatMap(value => {
    const item = parseMedia(value, type);
    if (!item || seen.has(mediaKey(item))) return [];
    seen.add(mediaKey(item));
    return [item];
  }).slice(0, 20);
}

export function selectFeatured(sections: HomeSection[], limit = 6): MediaItem[] {
  const queues = sections.slice(0, 2).map(section => section.mediaItems.filter(item => !!item.background));
  const selected: MediaItem[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (selected.length < limit && queues.some(queue => index < queue.length)) {
    for (const queue of queues) {
      const item = queue[index];
      if (item && !seen.has(mediaKey(item)) && selected.length < limit) {
        seen.add(mediaKey(item));
        selected.push(item);
      }
    }
    index++;
  }
  return selected;
}

export function ratingLabel(item: MediaItem): string | undefined {
  const imdb = Number(item.imdbRating);
  const score = Number.isFinite(imdb) && imdb > 0 && imdb <= 10 ? imdb : item.communityRating;
  return typeof score === 'number' && score > 0 && score <= 10 ? score.toFixed(1) : undefined;
}
