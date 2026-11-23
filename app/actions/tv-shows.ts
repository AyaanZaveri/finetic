"use server";

import { outboundFetch } from "@/lib/server/outbound-fetch";

import { publicArtworkUrl } from "@/lib/artwork";
import { getTMDBArtwork } from "@/lib/tmdb-artwork";
import { pickRandomEpisode } from "@/lib/media/shuffle-episode";

import type { MediaItem, StremioMetaResponse
} from "@/types/stremio";
import { getAuthData } from "@/lib/server/auth";
import { getInstalledAddons } from "./auth";
import { getMetadataProvider, type MetadataProvider } from "@/lib/server/metadata-provider";
import { parseSeriesRouteId } from "@/lib/series-route";

// ─── Helpers ─────────────────────────────────────────────────────

async function fetchAddonResource<T>(
  transportUrl: string,
  path: string,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    await getAuthData();
    const base = transportUrl.replace(/\/manifest\.json$/, "");
    const url = `${base}/${path}`;
    const response = await outboundFetch(url, { next: { revalidate: 300 }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return response.json();
  } catch {
    signal?.throwIfAborted();
    return null;
  }
}

async function readCinemetaSeries(seriesId: string, signal?: AbortSignal) {
  if (/^tmdb:[1-9]\d*$/.test(seriesId)) {
    const { resolveTMDBPlaybackId } = await import("@/lib/tmdb-discovery");
    seriesId = await resolveTMDBPlaybackId(seriesId, "series", signal);
  }
  const { cinemetaMetadata } = await import("@/lib/cinemeta");
  return await cinemetaMetadata("series", seriesId, signal);
}

async function readSeriesVideos(seriesId: string, provider: MetadataProvider, signal?: AbortSignal) {
  const fromCinemeta = () => readCinemetaSeries(seriesId, signal)
    .catch(() => { signal?.throwIfAborted(); return null; });
  if (provider === "cinemeta") {
    const meta = await fromCinemeta();
    if (meta?.videos?.length) return meta.videos;
  }
  if (/^tmdb:/.test(seriesId)) return [];
  const addons = await getInstalledAddons();
  for (const addon of addons) {
    if (!addon.manifest.resources.some(resource => (typeof resource === "string" ? resource : resource.name) === "meta")) continue;
    const data = await fetchAddonResource<StremioMetaResponse>(addon.transportUrl, `meta/series/${seriesId}.json`, signal);
    if (data?.meta?.videos?.length) return data.meta.videos;
  }
  return provider === "cinemeta" ? [] : (await fromCinemeta())?.videos ?? [];
}

// ─── Seasons ─────────────────────────────────────────────────────

export interface Season {
  number: number;
  name: string;
  episodeCount: number;
  overview?: string;
  poster?: string;
}

export async function fetchSeasons(seriesId: string, signal?: AbortSignal): Promise<Season[]> {
  try {
    seriesId = parseSeriesRouteId(seriesId).seriesId;
    const provider = await getMetadataProvider();
    if (provider === "tmdb" || (provider !== "cinemeta" && /^tmdb:/.test(seriesId))) {
      const { getTMDBSeasons } = await import("@/lib/tmdb-discovery");
      const seasons = await getTMDBSeasons(seriesId, signal).catch(() => { signal?.throwIfAborted(); return []; });
      if (seasons.length) return seasons;
    }
    const videos = await readSeriesVideos(seriesId, provider, signal);
    const seasonMap = new Map<number, number>();
    for (const video of videos) {
      const number = video.season ?? 1;
      seasonMap.set(number, (seasonMap.get(number) || 0) + 1);
    }
    if (seasonMap.size === 0 && provider === "cinemeta" && /^tmdb:/.test(seriesId)) {
      const { getTMDBSeasons } = await import("@/lib/tmdb-discovery");
      return await getTMDBSeasons(seriesId, signal);
    }
    return Array.from(seasonMap.entries()).sort(([a], [b]) => a - b)
      .map(([number, episodeCount]) => ({ number, name: `Season ${number}`, episodeCount }));
  } catch (error) {
    signal?.throwIfAborted();
    console.error("Failed to fetch seasons:", error);
    return [];
  }
}

// ─── Episodes ────────────────────────────────────────────────────

export interface Episode {
  id: string;
  title: string;
  season: number;
  episode: number;
  overview?: string;
  thumbnail?: string;
  released?: string;
  runtime?: string | number;
  communityRating?: number;
  ratingSource?: string;
  voteCount?: number;
  resumePositionTicks?: number;
  progressPercent?: number;
}

export async function fetchEpisodes(
  seriesId: string,
  seasonNumber?: number,
  signal?: AbortSignal,
  includeArtwork = true,
): Promise<Episode[]> {
  try {
    seriesId = parseSeriesRouteId(seriesId).seriesId;
    const provider = await getMetadataProvider();
    const nativeTMDBId = /^tmdb:/.test(seriesId);
    const fromTMDB = async () => {
      const { getTMDBSeasons, getTMDBEpisodes, mapTMDBSeasons } = await import("@/lib/tmdb-discovery");
      if (seasonNumber !== undefined) return await getTMDBEpisodes(seriesId, seasonNumber, signal);
      const seasons = await getTMDBSeasons(seriesId, signal);
      return (await mapTMDBSeasons(seasons.filter(season => season.number > 0).map(season => season.number),
        number => getTMDBEpisodes(seriesId, number, signal), signal)).flat();
    };
    if (provider === "tmdb" || (provider !== "cinemeta" && nativeTMDBId)) {
      const episodes = await fromTMDB().catch(() => { signal?.throwIfAborted(); return []; });
      if (episodes.length) return nativeTMDBId ? episodes : episodes.map(episode => ({
        ...episode, id: `${seriesId}:${episode.season}:${episode.episode}`, seriesId,
      }));
    }

    const videos = await readSeriesVideos(seriesId, provider, signal);
    if (!videos.length && provider === "cinemeta" && nativeTMDBId) return await fromTMDB();
    const selected = seasonNumber === undefined ? videos : videos.filter(video => (video.season ?? 1) === seasonNumber);
    return Promise.all(selected.map(async video => ({
      id: nativeTMDBId ? `${seriesId}:${video.season ?? 1}:${video.episode ?? 1}` : video.id,
      title: video.title || video.name || `Episode ${video.episode ?? 1}`,
      season: video.season ?? 1,
      episode: video.episode ?? 1,
      overview: video.overview,
      thumbnail: publicArtworkUrl(video.thumbnail) || (includeArtwork && provider !== "cinemeta"
        ? await getTMDBArtwork(seriesId, "series", "still", video.season ?? 1, video.episode ?? 1) : undefined),
      released: video.released,
      runtime: video.runtime,
      resumePositionTicks: typeof video.resumePositionTicks === "number" ? video.resumePositionTicks : undefined,
      progressPercent: typeof video.progressPercent === "number" ? video.progressPercent : undefined,
    })));
  } catch (error) {
    signal?.throwIfAborted();
    console.error("Failed to fetch episodes:", error);
    return [];
  }
}

// ─── TV Show Details ─────────────────────────────────────────────

export async function fetchTVShowDetails(
  seriesId: string
): Promise<MediaItem | null> {
  const { fetchMediaDetails } = await import("./media");
  return fetchMediaDetails(parseSeriesRouteId(seriesId).seriesId, "series");
}

// ─── Episode Details ─────────────────────────────────────────────

export async function fetchEpisodeDetails(seriesId: string, season: number, episode: number, signal?: AbortSignal): Promise<Episode | null> {
  const { metadataIdentity } = await import("@/lib/server/metadata-identity");
  const { serverMetadataCache, opaqueMetadataIdentity } = await import("@/lib/server/metadata-cache");
  const { episodeEnvelope } = await import("@/lib/media/metadata");
  const { scope, revision, provider } = await metadataIdentity();
  return serverMetadataCache.read(opaqueMetadataIdentity([scope, revision, "episode", seriesId, season, episode]), async sharedSignal => {
    const item = await fetchEpisodeDetailsUncached(seriesId, season, episode, provider, sharedSignal);
    if (item) episodeEnvelope(item, seriesId, Date.now());
    return item;
  }, signal);
}

async function fetchEpisodeDetailsUncached(
  seriesId: string,
  season: number,
  episode: number,
  provider: MetadataProvider,
  signal?: AbortSignal
): Promise<Episode | null> {
  seriesId = parseSeriesRouteId(seriesId).seriesId;
  if (provider !== "cinemeta") {
    try {
      // A single canonical episode lookup also repairs unnamed add-on/resume entries.
      const { getTMDBEpisode } = await import("@/lib/tmdb-discovery");
      const item = await getTMDBEpisode(seriesId, season, episode, signal);
      if (item.name?.trim()) return { id: `${seriesId}:${season}:${episode}`, title: item.name,
        season, episode, thumbnail: item.thumbnail, released: item.released, runtime: item.runtime,
        overview: item.overview, communityRating: item.communityRating, ratingSource: item.ratingSource, voteCount: item.voteCount };
    } catch { signal?.throwIfAborted(); }
  }
  const episodes = await fetchEpisodes(seriesId, season, signal);
  return episodes.find((item) => item.episode === episode) || null;
}

// ─── Next Episode ────────────────────────────────────────────────

async function withEpisodeArtwork(seriesId: string, episode: Episode | null): Promise<Episode | null> {
  if (!episode || publicArtworkUrl(episode.thumbnail) || await getMetadataProvider() === "cinemeta") return episode;
  return { ...episode, thumbnail: await getTMDBArtwork(seriesId, "series", "still", episode.season, episode.episode) };
}

export async function getRandomEpisodeForSeries(seriesId: string): Promise<Episode | null> {
  const episode = pickRandomEpisode(await fetchEpisodes(seriesId, undefined, undefined, false));
  return withEpisodeArtwork(seriesId, episode);
}

/** Advance through regular seasons only, preserving explicit episode playback. */
export async function getFollowingEpisodeForSeries(
  seriesId: string,
  season: number,
  episode: number,
  signal?: AbortSignal,
): Promise<Episode | null> {
  if (!Number.isSafeInteger(season) || season < 0 || !Number.isSafeInteger(episode) || episode < 1) return null;
  if (season === 0) return getNextEpisodeForSeries(seriesId, signal);
  const episodes = await fetchEpisodes(seriesId, season, signal, false);
  const following = episodes.filter(item => item.season === season && item.episode > episode && (!item.released || Date.parse(item.released) <= Date.now()))
    .sort((a, b) => a.episode - b.episode)[0];
  if (following) return withEpisodeArtwork(seriesId, following);
  const seasons = (await fetchSeasons(seriesId, signal))
    .filter(item => item.number > season && item.episodeCount > 0)
    .sort((a, b) => a.number - b.number);
  for (const next of seasons) {
    const first = (await fetchEpisodes(seriesId, next.number, signal, false))
      .filter(item => item.season === next.number && item.episode > 0 && (!item.released || Date.parse(item.released) <= Date.now()))
      .sort((a, b) => a.episode - b.episode)[0];
    if (first) return withEpisodeArtwork(seriesId, first);
  }
  return null;
}

export async function getNextEpisodeForSeries(
  seriesId: string,
  signal?: AbortSignal
): Promise<Episode | null> {
  try {
    const episodes = await fetchEpisodes(seriesId, 1, signal, false);
    // Provider order can put specials or later episodes first.
    return withEpisodeArtwork(seriesId, episodes.find(episode => episode.season === 1 && episode.episode === 1) || null);
  } catch (error) {
    console.error("Failed to get next episode:", error);
    return null;
  }
}
