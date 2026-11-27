export type MediaType = 'movie' | 'series';
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
  imdbRating?: string;
  communityRating?: number;
  ratingSource?: string;
  genres?: string[];
  runtime?: string;
}
export interface HomeSection {
  key: string;
  sectionName: string;
  mediaItems: MediaItem[];
}

export const mediaKey = (item: MediaItem) => `${item.type}:${item.id}`;

const TMDB_IMAGE = /^https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\/[\w.-]+\.(?:jpg|jpeg|png|webp|svg)$/i;
const CINEMETA_IMAGE = /^https:\/\/images\.metahub\.space\/(?:poster|background|logo)\/(?:small|medium|large|original)\/tt\d+\/img$/i;

export function artworkUrl(value: unknown): string | undefined {
  return typeof value === 'string' && (TMDB_IMAGE.test(value) || CINEMETA_IMAGE.test(value)) ? value : undefined;
}

export function resizeBackdrop(url: string | undefined): string | undefined {
  return artworkUrl(url)?.replace(/\/t\/p\/[^/]+\//, '/t/p/w780/');
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function releaseYear(item: { year?: unknown; releaseInfo?: unknown }): number | undefined {
  const raw = item.year ?? (typeof item.releaseInfo === 'string' ? /^\s*(\d{4})\b/.exec(item.releaseInfo)?.[1] : undefined);
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1888 && parsed <= new Date().getFullYear() + 1 ? parsed : undefined;
}

export function parseMedia(value: unknown, expected?: MediaType): MediaItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if ((item.type !== 'movie' && item.type !== 'series') || (expected && item.type !== expected)) return null;
  const id = text(item.id);
  const name = text(item.name);
  if (!id || !name || !/^(?:tt\d+|tmdb:\d+)$/.test(id)) return null;
  const rating = typeof item.communityRating === 'number' && item.communityRating > 0 && item.communityRating <= 10 ? item.communityRating : undefined;
  return {
    id, type: item.type, name,
    poster: artworkUrl(item.poster), background: artworkUrl(item.background), logo: artworkUrl(item.logo),
    description: text(item.description), year: releaseYear(item), releaseInfo: text(item.releaseInfo),
    imdbRating: text(item.imdbRating), communityRating: rating, ratingSource: text(item.ratingSource),
    genres: Array.isArray(item.genres) ? item.genres.flatMap(value => text(value) ?? []).slice(0, 4) : undefined,
    runtime: text(item.runtime),
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
