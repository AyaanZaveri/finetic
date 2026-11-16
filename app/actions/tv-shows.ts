"use server";

import { releaseYear } from "@/lib/media/release-year";
import { outboundFetch } from "@/lib/server/outbound-fetch";

import { publicArtworkUrl } from "@/lib/artwork";
import { getTMDBArtwork } from "@/lib/tmdb-artwork";
import { resolveMediaArtwork } from "@/lib/server/media-artwork";
import { pickRandomEpisode } from "@/lib/media/shuffle-episode";

import type { MediaItem, StremioMeta, StremioMetaResponse
} from "@/types/stremio";
import { getAuthData } from "@/lib/server/auth";
import { getInstalledAddons } from "./auth";
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

function metaToMediaItem(meta: StremioMeta, addonTransportUrl?: string): MediaItem {
  return {
    id: meta.id,
    type: meta.type as MediaItem["type"],
    name: meta.name,
    poster: publicArtworkUrl(meta.poster),
    background: publicArtworkUrl(meta.background),
    logo: publicArtworkUrl(meta.logo),
    description: meta.description,
    releaseInfo: meta.releaseInfo,
    imdbRating: meta.imdbRating,
    genres: meta.genres,
    cast: meta.cast,
    director: meta.director,
    writer: meta.writer,
    runtime: meta.runtime,
    year: releaseYear(meta.year, meta.releaseInfo),
    videos: meta.videos?.map((video) => ({
      ...video,
      thumbnail: publicArtworkUrl(video.thumbnail),
    })),
    links: meta.links,
    trailers: meta.trailers,
    behaviorHints: meta.behaviorHints,
    addonTransportUrl,
  };
}

// ─── Seasons ─────────────────────────────────────────────────────

export interface Season {
  number: number;
  name: string;
  episodeCount: number;
}

export async function fetchSeasons(seriesId: string, signal?: AbortSignal): Promise<Season[]> {
  try {
    seriesId = parseSeriesRouteId(seriesId).seriesId;
    if (/^tmdb:[1-9]\d*$/.test(seriesId)) {
      const { getTMDBSeasons } = await import("@/lib/tmdb-discovery");
      return await getTMDBSeasons(seriesId, signal);
    }
    const addons = await getInstalledAddons();

    for (const addon of addons) {
      const hasMetaResource = addon.manifest.resources.some((r) =>
        typeof r === "string" ? r === "meta" : r.name === "meta"
      );
      if (!hasMetaResource) continue;

      const data = await fetchAddonResource<StremioMetaResponse>(
        addon.transportUrl,
        `meta/series/${seriesId}.json`,
        signal
      );

      if (data?.meta?.videos && data.meta.videos.length > 0) {
        // Derive seasons from video objects
        const seasonMap = new Map<number, number>();
        for (const video of data.meta.videos) {
          const sNum = video.season ?? 1;
          seasonMap.set(sNum, (seasonMap.get(sNum) || 0) + 1);
        }

        return Array.from(seasonMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([number, count]) => ({
            number,
            name: `Season ${number}`,
            episodeCount: count,
          }));
      }
    }

    return [];
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
    if (/^tmdb:[1-9]\d*$/.test(seriesId)) {
      const { getTMDBSeasons, getTMDBEpisodes, mapTMDBSeasons } = await import("@/lib/tmdb-discovery");
      if (seasonNumber !== undefined) return await getTMDBEpisodes(seriesId, seasonNumber, signal);
      const seasons = await getTMDBSeasons(seriesId, signal);
      return (await mapTMDBSeasons(seasons.filter(season => season.number > 0).map(season => season.number),
        number => getTMDBEpisodes(seriesId, number, signal), signal)).flat();
    }
    const addons = await getInstalledAddons();

    for (const addon of addons) {
      const hasMetaResource = addon.manifest.resources.some((r) =>
        typeof r === "string" ? r === "meta" : r.name === "meta"
      );
      if (!hasMetaResource) continue;

      const data = await fetchAddonResource<StremioMetaResponse>(
        addon.transportUrl,
        `meta/series/${seriesId}.json`,
        signal
      );

      if (data?.meta?.videos) {
        let videos = data.meta.videos;

        if (seasonNumber !== undefined) {
          videos = videos.filter((v) => (v.season ?? 1) === seasonNumber);
        }

        return Promise.all(videos.map(async (v) => ({
          id: v.id,
          title: v.title || v.name || `Episode ${v.episode ?? 1}`,
          season: v.season ?? 1,
          episode: v.episode ?? 1,
          overview: v.overview,
          thumbnail: publicArtworkUrl(v.thumbnail) || (includeArtwork ? await getTMDBArtwork(seriesId, "series", "still", v.season ?? 1, v.episode ?? 1) : undefined),
          released: v.released,
          resumePositionTicks:
            typeof v.resumePositionTicks === "number"
              ? v.resumePositionTicks
              : undefined,
          progressPercent:
            typeof v.progressPercent === "number"
              ? v.progressPercent
              : undefined,
        })));
      }
    }

    return [];
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
  try {
    seriesId = parseSeriesRouteId(seriesId).seriesId;
    if (/^tmdb:[1-9]\d*$/.test(seriesId)) {
      const { tmdbMediaItem } = await import("@/lib/tmdb-discovery");
      return await tmdbMediaItem(seriesId, "series");
    }
    const addons = await getInstalledAddons();

    for (const addon of addons) {
      const hasMetaResource = addon.manifest.resources.some((r) =>
        typeof r === "string" ? r === "meta" : r.name === "meta"
      );
      if (!hasMetaResource) continue;

      const data = await fetchAddonResource<StremioMetaResponse>(
        addon.transportUrl,
        `meta/series/${seriesId}.json`
      );

      if (data?.meta) {
        return resolveMediaArtwork(metaToMediaItem(data.meta, addon.transportUrl), true);
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to fetch TV show details:", error);
    return null;
  }
}

// ─── Episode Details ─────────────────────────────────────────────

export async function fetchEpisodeDetails(seriesId: string, season: number, episode: number, signal?: AbortSignal): Promise<Episode | null> {
  const { metadataIdentity } = await import("@/lib/server/metadata-identity");
  const { serverMetadataCache, opaqueMetadataIdentity } = await import("@/lib/server/metadata-cache");
  const { episodeEnvelope } = await import("@/lib/media/metadata");
  const { scope, revision } = await metadataIdentity();
  return serverMetadataCache.read(opaqueMetadataIdentity([scope, revision, "episode", seriesId, season, episode]), async sharedSignal => {
    const item = await fetchEpisodeDetailsUncached(seriesId, season, episode, sharedSignal);
    if (item) episodeEnvelope(item, seriesId, Date.now());
    return item;
  }, signal);
}

async function fetchEpisodeDetailsUncached(
  seriesId: string,
  season: number,
  episode: number,
  signal?: AbortSignal
): Promise<Episode | null> {
  try {
    seriesId = parseSeriesRouteId(seriesId).seriesId;
    // A single canonical episode lookup also repairs unnamed add-on/resume entries.
    if (!/^tmdb:[1-9]\d*$/.test(seriesId)) await getAuthData();
    const { getTMDBEpisode } = await import("@/lib/tmdb-discovery");
    const item = await getTMDBEpisode(seriesId, season, episode, signal);
    if (item.name?.trim()) return { id: `${seriesId}:${season}:${episode}`, title: item.name,
      season, episode, thumbnail: item.thumbnail, released: item.released, runtime: item.runtime,
      overview: item.overview, communityRating: item.communityRating, ratingSource: item.ratingSource, voteCount: item.voteCount };
  } catch { signal?.throwIfAborted(); }
  try {
    if (/^tmdb:/.test(seriesId)) return null;
    const episodes = await fetchEpisodes(seriesId, season, signal);
    return episodes.find((e) => e.episode === episode) || null;
  } catch (error) {
    console.error("Failed to fetch episode details:", error);
    return null;
  }
}

// ─── Next Episode ────────────────────────────────────────────────

async function withEpisodeArtwork(seriesId: string, episode: Episode | null): Promise<Episode | null> {
  if (!episode || publicArtworkUrl(episode.thumbnail)) return episode;
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
