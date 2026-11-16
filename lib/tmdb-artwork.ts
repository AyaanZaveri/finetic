import "server-only";
import { fetchTMDB, resolveTMDBId } from "@/lib/tmdb";
import type { ArtworkKind } from "@/lib/artwork";
import { getTMDBToken } from "@/lib/tmdb-credentials";
import { unstable_cache } from "next/cache";
import { opaqueMetadataIdentity } from "@/lib/server/metadata-cache";

export interface TMDBImage {
  file_path: string;
  iso_639_1?: string | null;
  vote_average?: number;
  vote_count?: number;
  width?: number;
}

export function selectArtwork(images: TMDBImage[] = [], kind: ArtworkKind): string | undefined {
  const languageRank = (image: TMDBImage) => {
    const preferred = kind === "backdrop" || kind === "still" ? null : "en";
    return image.iso_639_1 === preferred ? 2
      : image.iso_639_1 == null || image.iso_639_1 === "en" ? 1 : 0;
  };
  const image = images.filter((item) => {
    const raster = /^\/[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(item.file_path);
    // TMDB's preferred logo can be a vector; the upstream addon keeps it.
    return raster || (kind === "logo" && /^\/[\w.-]+\.svg$/i.test(item.file_path));
  }).sort((a, b) => {
    const language = languageRank(b) - languageRank(a);
    // Match the TMDB addon's logo behavior: prefer the language, then keep
    // TMDB's original order. Size or local ratings must not replace its choice.
    if (kind === "logo") return language;
    return language
      || (b.vote_average ?? 0) - (a.vote_average ?? 0)
      || (b.vote_count ?? 0) - (a.vote_count ?? 0)
      || (b.width ?? 0) - (a.width ?? 0);
  })[0];
  if (!image) return undefined;
  const size = kind === "backdrop" || kind === "logo" ? "original" : "w500";
  return `https://image.tmdb.org/t/p/${size}${image.file_path}`;
}

// Only resolved public image URLs are retained. Credentials scope the private,
// bounded process cache; responses and browser/CDN caches remain account-safe.
const resolvedArtwork = new Map<string, { url: string; expires: number }>();
const pendingArtwork = new Map<string, Promise<string | undefined>>();
const ARTWORK_CACHE_LIMIT = 256;
const ARTWORK_CACHE_MS = 86_400_000;

export async function getTMDBArtwork(
  id: string, type: "movie" | "series", kind: ArtworkKind,
  season?: number, episode?: number,
): Promise<string | undefined> {
  try { id = decodeURIComponent(id); } catch { return undefined; }
  const canonical = /^(tt\d+)(?::|$)/.exec(id)?.[1] ?? /^(tmdb:\d+)(?::\d+:\d+)?$/.exec(id)?.[1];
  if (!canonical) return undefined;
  id = canonical;
  const token = await getTMDBToken();
  if (!token) return undefined;
  const key = JSON.stringify([token, id, type, kind, season, episode]);
  const cached = resolvedArtwork.get(key);
  if (cached && cached.expires > Date.now()) {
    resolvedArtwork.delete(key);
    resolvedArtwork.set(key, cached);
    return cached.url;
  }
  resolvedArtwork.delete(key);
  const existing = pendingArtwork.get(key);
  if (existing) return existing;
  const read = unstable_cache(async () => {
    const url = await resolveArtwork(id, type, kind, token, season, episode);
    if (!url) throw new Error("Artwork unavailable");
    return url;
  }, ["resolved-artwork-v1", opaqueMetadataIdentity([token, id, type, kind, season, episode])], { revalidate: 86400 });
  const task = read().catch(() => undefined).then(url => {
    // Transient failures and missing artwork must remain retryable.
    if (url) {
      resolvedArtwork.delete(key);
      resolvedArtwork.set(key, { url, expires: Date.now() + ARTWORK_CACHE_MS });
      if (resolvedArtwork.size > ARTWORK_CACHE_LIMIT) resolvedArtwork.delete(resolvedArtwork.keys().next().value!);
    }
    return url;
  }).finally(() => { if (pendingArtwork.get(key) === task) pendingArtwork.delete(key); });
  // Bound retained in-flight state too, without cancelling another caller's work.
  if (pendingArtwork.size < ARTWORK_CACHE_LIMIT) pendingArtwork.set(key, task);
  return task;
}

// Poster, backdrop and logo selection share the same upstream image list.
// Coalesce concurrent reads without retaining response bodies or credentials.
const pendingImages = new Map<string, Promise<unknown>>();
async function artworkData<T>(path: string, token: string): Promise<T | null> {
  const key = opaqueMetadataIdentity([path, token]);
  const existing = pendingImages.get(key);
  if (existing) return existing as Promise<T | null>;
  const task = fetchTMDB<T>(path, token).finally(() => {
    if (pendingImages.get(key) === task) pendingImages.delete(key);
  });
  if (pendingImages.size < 64) pendingImages.set(key, task);
  return task;
}

async function resolveArtwork(
  id: string, type: "movie" | "series", kind: ArtworkKind, token: string,
  season?: number, episode?: number,
): Promise<string | undefined> {
  const tmdbId = await resolveTMDBId(id, type, token);
  if (!tmdbId) return undefined;
  const mediaType = type === "series" ? "tv" : "movie";
  if (kind === "still") {
    if (type !== "series" || typeof season !== "number" || !Number.isSafeInteger(season) || season < 0
      || typeof episode !== "number" || !Number.isSafeInteger(episode) || episode < 1) return undefined;
    // One cached season response supplies every episode card's still.
    const data = await artworkData<{ episodes?: { episode_number: number; still_path?: string | null }[] }>(
      `tv/${tmdbId}/season/${season}?language=en-US`, token,
    );
    const path = data?.episodes?.find((item) => item.episode_number === episode)?.still_path;
    return path ? selectArtwork([{ file_path: path }], kind) : undefined;
  }
  const data = await artworkData<{ posters?: TMDBImage[]; backdrops?: TMDBImage[]; logos?: TMDBImage[] }>(
    `${mediaType}/${tmdbId}/images?include_image_language=en,null`, token,
  );
  const images = kind === "poster" ? data?.posters : kind === "backdrop" ? data?.backdrops : data?.logos;
  const selected = selectArtwork(images, kind);
  if (selected || kind !== "poster" || !data) return selected;
  // Regional titles may only have a poster in their original language. Keep
  // English/untagged art preferred, but don't mistake that filter for no art.
  const international = await artworkData<{ posters?: TMDBImage[] }>(`${mediaType}/${tmdbId}/images`, token);
  return selectArtwork(international?.posters, kind);
}
