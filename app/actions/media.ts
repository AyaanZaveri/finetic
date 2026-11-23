"use server";

import { releaseYear } from "@/lib/media/release-year";
import { outboundFetch } from "@/lib/server/outbound-fetch";
import { readCatalog } from "@/lib/server/catalog-cache";

import { publicArtworkUrl } from "@/lib/artwork";
import { resolveMediaArtwork, resolveArtworkList } from "@/lib/server/media-artwork";
import { getTMDBArtwork } from "@/lib/tmdb-artwork";

import type {
  StremioAddon,
  StremioMetaPreview,
  StremioMeta,
  StremioStream,
  MediaItem,
  StremioCatalogResponse,
  StremioMetaResponse,
  StremioStreamResponse,
} from "@/types/stremio";
import { getAuthData } from "@/lib/server/auth";
import { getInstalledAddons } from "./auth";
import { completeMediaDescription } from "@/lib/media-description";
import { mergePlaybackDetails } from "@/lib/media/playback-details";
import { markVideoWatched, orderedEpisodeIds } from "@/lib/stremio-watched";
import { fetchEpisodes } from "./tv-shows";
import { resolveTMDBPlaybackId } from "@/lib/tmdb-discovery";
import { parseSeriesRouteId } from "@/lib/series-route";

const STREMIO_API = "https://api.strem.io/api";
const ADDON_RESOURCE_TIMEOUT_MS = 3_500;

// ─── Helpers ─────────────────────────────────────────────────────

function addonSupportsResource(
  addon: StremioAddon,
  resource: string,
  type?: string
): boolean {
  return addon.manifest.resources.some((r) => {
    if (typeof r === "string") return r === resource;
    if (r.name !== resource) return false;
    if (!type) return true;
    // Some addon manifests omit `types` for generic stream resources.
    if (!r.types || r.types.length === 0) return true;
    return r.types.includes(type);
  });
}

function addonSupportsCatalog(addon: StremioAddon): boolean {
  return (
    addon.manifest.catalogs.length > 0 &&
    addonSupportsResource(addon, "catalog")
  );
}

async function fetchAddonResource<T>(
  transportUrl: string,
  path: string,
  init?: Parameters<typeof fetch>[1]
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ADDON_RESOURCE_TIMEOUT_MS);

  try {
    await getAuthData();
    // The transport URL may already end with /manifest.json — strip to base
    const base = transportUrl.replace(/\/manifest\.json$/, "");
    const url = `${base}/${path}`;

    const shouldBypassDataCache = path.startsWith("catalog/");

    const response = await outboundFetch(url, {
      ...(init ?? {}),
      signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
      ...(init?.cache || init?.next
        ? {}
        : shouldBypassDataCache
          ? { cache: "no-store" }
          : { next: { revalidate: 300 } }),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    init?.signal?.throwIfAborted();
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function metaPreviewToMediaItem(
  meta: StremioMetaPreview,
  addonTransportUrl?: string
): MediaItem {
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
    genres: normalizeStringList(meta.genres),
    links: meta.links,
    addonTransportUrl,
  };
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === "string") {
    const items = value
      .split(/,\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function fullMetaToMediaItem(
  meta: StremioMeta,
  addonTransportUrl?: string
): MediaItem {
  return {
    ...metaPreviewToMediaItem(meta, addonTransportUrl),
    cast: normalizeStringList(meta.cast),
    director: normalizeStringList(meta.director),
    writer: normalizeStringList(meta.writer),
    runtime: meta.runtime,
    year: releaseYear(meta.year, meta.releaseInfo),
    videos: meta.videos?.map((video) => ({
      ...video,
      thumbnail: publicArtworkUrl(video.thumbnail),
    })),
    trailers: meta.trailers,
    behaviorHints: meta.behaviorHints,
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUsableMediaDetails(item: MediaItem): boolean {
  if (!hasText(item.name)) return false;

  return Boolean(
    hasText(item.poster) ||
      hasText(item.background) ||
      hasText(item.logo) ||
      hasText(item.description) ||
      hasText(item.releaseInfo) ||
      hasText(item.runtime) ||
      typeof item.year === "number" ||
      (Array.isArray(item.genres) && item.genres.length > 0) ||
      (Array.isArray(item.cast) && item.cast.length > 0) ||
      (Array.isArray(item.director) && item.director.length > 0)
  );
}

// ─── Catalog / Browse ────────────────────────────────────────────

export async function fetchCatalogItems(
  type: string = "movie",
  catalogId: string = "top",
  addonTransportUrl?: string,
  signal?: AbortSignal,
  maxItems = 20,
  throwOnError = false,
): Promise<MediaItem[]> {
  try {
    signal?.throwIfAborted();
    if (addonTransportUrl) {
      return await readCatalog(
        addonTransportUrl, type, catalogId,
        meta => metaPreviewToMediaItem(meta, addonTransportUrl), signal, maxItems,
      );
    }

    const addons = await getInstalledAddons();

    const targets = addons.filter((a) => addonSupportsCatalog(a));

    const results: MediaItem[] = [];

    for (const addon of targets) {
      // Find a matching catalog entry
      const catalog = addon.manifest.catalogs.find(
        (c) => c.type === type && (c.id === catalogId || catalogId === "top")
      );

      if (!catalog) continue;

      const items = await readCatalog(
        addon.transportUrl, type, catalog.id,
        meta => metaPreviewToMediaItem(meta, addon.transportUrl), signal, maxItems,
      ).catch(() => { signal?.throwIfAborted(); return [] as MediaItem[]; });
      results.push(...items);
    }

    return results;
  } catch (error) {
    signal?.throwIfAborted();
    if (throwOnError) throw error;
    console.error("Failed to fetch catalog items:", error);
    return [];
  }
}

export async function fetchMovies(limit: number = 20): Promise<MediaItem[]> {
  const items = await fetchCatalogItems("movie", "top", undefined, undefined, limit);
  return items.slice(0, limit);
}

export async function fetchTVShows(limit: number = 20): Promise<MediaItem[]> {
  const items = await fetchCatalogItems("series", "top", undefined, undefined, limit);
  return items.slice(0, limit);
}

// ─── Metadata ────────────────────────────────────────────────────

export async function fetchMediaDetails(mediaItemId: string, type: string = "movie", signal?: AbortSignal, options?: { playback?: boolean }): Promise<MediaItem | null> {
  const { metadataIdentity } = await import("@/lib/server/metadata-identity");
  const { serverMetadataCache, opaqueMetadataIdentity } = await import("@/lib/server/metadata-cache");
  const { titleEnvelope } = await import("@/lib/media/metadata");
  const { scope, revision } = await metadataIdentity();
  return serverMetadataCache.read(opaqueMetadataIdentity([scope, revision, "title", mediaItemId, type, Boolean(options?.playback)]), async sharedSignal => {
    const item = await fetchMediaDetailsUncached(mediaItemId, type, sharedSignal, options);
    if (item) titleEnvelope(item, Date.now());
    return item;
  }, signal);
}

async function fetchMediaDetailsUncached(
  mediaItemId: string,
  type: string = "movie",
  signal?: AbortSignal,
  options?: { playback?: boolean },
): Promise<MediaItem | null> {
  try {
    // Next's route params can retain percent-encoded separators. Normalize
    // before choosing the public TMDB path versus account-owned add-ons.
    try { mediaItemId = decodeURIComponent(mediaItemId); } catch { /* Keep invalid encodings bounded by the existing ID checks. */ }
    if (/^tmdb:[1-9]\d*$/.test(mediaItemId) && (type === "movie" || type === "series")) {
      if (options?.playback) await getAuthData();
      const { tmdbMediaItem, resolveTMDBPlaybackId } = await import("@/lib/tmdb-discovery");
      if (options?.playback) {
        try {
          const resolved = await resolveTMDBPlaybackId(mediaItemId, type, signal);
          if (resolved !== mediaItemId) {
            const addonDetails = await fetchMediaDetails(resolved, type, signal, options);
            if (addonDetails) return addonDetails;
          }
        } catch { signal?.throwIfAborted(); }
      }
      return await tmdbMediaItem(mediaItemId, type, signal);
    }
    const builtInDetails = async () => {
      if ((type !== "movie" && type !== "series") || !/^tt\d+$/.test(mediaItemId)) return null;
      if (options?.playback) await getAuthData();
      const { cinemetaMetadata } = await import("@/lib/cinemeta");
      const meta = await cinemetaMetadata(type, mediaItemId, signal);
      return meta ? fullMetaToMediaItem(meta) : null;
    };
    const addons = await getInstalledAddons();

    // Try addons that support meta for this type  
    const metaAddons = addons.filter((a) =>
      addonSupportsResource(a, "meta", type)
    );

    const metaRequests = metaAddons.map(async (addon) => {
      const data = await fetchAddonResource<StremioMetaResponse>(
        addon.transportUrl,
        `meta/${type}/${mediaItemId}.json`,
        { signal }
      );

      if (!data?.meta) {
        throw new Error("Addon did not return metadata.");
      }

      return resolveMediaArtwork(fullMetaToMediaItem(data.meta, addon.transportUrl), true);
    });

    if (options?.playback) {
      let merged: MediaItem | null = null;
      const arrivals = metaRequests.map(async pending => {
        const item = await pending;
        merged = merged ? mergePlaybackDetails(item, merged) : mergePlaybackDetails(item);
        return merged;
      });
      // Return as soon as the player's core fields are complete, or all bounded
      // provider requests settle. Synopsis repair must never delay the player.
      const complete = Promise.any(arrivals.map(async pending => {
        const item = await pending;
        if (!item.name || !item.year || !item.runtime || !item.imdbRating || !item.cast?.length) throw new Error("Partial player metadata");
        return item;
      })).catch(() => null);
      const settled = Promise.allSettled(arrivals).then(() => merged);
      const result = await Promise.race([complete.then(async item => item || await settled), settled]);
      if (result || (type !== "movie" && type !== "series")) return result;
      const builtIn = await builtInDetails().catch(() => { signal?.throwIfAborted(); return null; });
      if (builtIn) return builtIn;
      const { tmdbMediaItem } = await import("@/lib/tmdb-discovery");
      return await tmdbMediaItem(mediaItemId, type, signal);
    }

    const withCompleteDescription = (item: MediaItem) =>
      completeMediaDescription(
        item,
        metaRequests,
        /^tt\d+$/.test(mediaItemId) && (type === "movie" || type === "series")
          ? async () => {
              // Cinemeta v3 can return a truncated synopsis. Its live endpoint
              // can supply a complete description for the same IMDb id.
              const data = await fetchAddonResource<StremioMetaResponse>(
                "https://cinemeta-live.strem.io",
                `meta/${type}/${mediaItemId}.json`,
                { signal },
              );
              return data?.meta?.id === mediaItemId
                ? data.meta.description
                : undefined;
            }
          : undefined,
      );

    if (type !== "movie") {
      const item = await Promise.any(metaRequests).catch(() => null);
      return item ? await withCompleteDescription(item) : await builtInDetails();
    }

    const usableMetaResult = await Promise.any(
      metaRequests.map(async (request) => {
        const item = await request;
        if (!isUsableMediaDetails(item)) {
          throw new Error("Addon returned incomplete metadata.");
        }

        return item;
      })
    ).catch(() => null);

    if (usableMetaResult) return await withCompleteDescription(usableMetaResult);

    const settledMetaResults = await Promise.allSettled(metaRequests);
    const fallbackMeta = settledMetaResults.find(
      (result): result is PromiseFulfilledResult<MediaItem> =>
        result.status === "fulfilled" && hasText(result.value.name)
    );

    return fallbackMeta ? await withCompleteDescription(fallbackMeta.value) : await builtInDetails();
  } catch (error) {
    signal?.throwIfAborted();
    console.error("Failed to fetch media details:", error);
    return null;
  }
}

// ─── Streams ─────────────────────────────────────────────────────

export async function fetchStreams(
  mediaItemId: string,
  type: string = "movie"
): Promise<StremioStream[]> {
  try {
    const targets = await getStreamAddonTargets(type);
    const results = await Promise.all(
      targets.map((target) =>
        fetchStreamsFromAddon(mediaItemId, type, target.transportUrl, target.name)
      )
    );
    return results.flat();
  } catch (error) {
    console.error("Failed to fetch streams:", error);
    return [];
  }
}

export interface StreamAddonTarget {
  id: string;
  name: string;
  transportUrl: string;
}

export async function getStreamAddonTargets(
  type: string = "movie"
): Promise<StreamAddonTarget[]> {
  try {
    const addons = await getInstalledAddons();

    return addons
      .filter((addon) => addonSupportsResource(addon, "stream", type))
      .map((addon) => ({
        id: addon.manifest.id || addon.transportUrl,
        name: addon.manifest.name || "Unknown addon",
        transportUrl: addon.transportUrl,
      }));
  } catch (error) {
    console.error("Failed to fetch stream addon targets:", error);
    return [];
  }
}

export async function fetchStreamsFromAddon(
  mediaItemId: string,
  type: string = "movie",
  addonTransportUrl: string,
  addonName?: string,
  signal?: AbortSignal
): Promise<StremioStream[]> {
  try {
    const streamRequestHeaders = {
      Referer: "https://web.stremio.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
    };

    const data = await fetchAddonResource<StremioStreamResponse>(
      addonTransportUrl,
      `stream/${type}/${mediaItemId}.json`,
      { headers: streamRequestHeaders, cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }
    );

    if (!data?.streams?.length) {
      return [];
    }

    return data.streams.map((stream) => ({
      ...stream,
      name: stream.name || addonName || "Unknown source",
    }));
  } catch (error) {
    signal?.throwIfAborted();
    console.error("Failed to fetch streams from addon:", error);
    return [];
  }
}

// ─── Similar / Related ──────────────────────────────────────────

export async function fetchSimilarItems(
  itemId: string,
  type: string = "movie",
  limit: number = 12
): Promise<MediaItem[]> {
  // Stremio doesn't have a direct "similar items" endpoint.
  // We can try fetching from the same catalog or use IMDB relations.
  // For now, return items from the same catalog type
  const items = await fetchCatalogItems(type, "top", undefined, undefined, limit + 1);
  return items.filter((item) => item.id !== itemId).slice(0, limit);
}

// ─── Library Items (Catalogs per addon) ─────────────────────────

export async function fetchLibraryItems(
  addonTransportUrl: string,
  limit: number = 50
): Promise<{ items: MediaItem[]; totalRecordCount: number; incomplete?: boolean }> {
  try {
    const addons = await getInstalledAddons();
    const addon = addons.find((a) => a.transportUrl === addonTransportUrl);

    if (!addon) return { items: [], totalRecordCount: 0 };

    // Keep provider order while fetching independent catalogs concurrently.
    const catalogs = addon.manifest.catalogs;
    const results: MediaItem[][] = new Array(catalogs.length);
    let next = 0;
    let incomplete = false;
    await Promise.all(Array.from({ length: Math.min(4, catalogs.length) }, async () => {
      while (next < catalogs.length) {
        const index = next++;
        const catalog = catalogs[index];
        const data = await fetchAddonResource<StremioCatalogResponse>(
          addon.transportUrl, `catalog/${catalog.type}/${catalog.id}.json`,
        );
        if (!data) incomplete = true;
        results[index] = (data?.metas ?? []).map(meta => metaPreviewToMediaItem(meta, addon.transportUrl));
      }
    }));
    const allItems = results.flat();

    return {
      items: await resolveArtworkList(allItems.slice(0, limit)),
      totalRecordCount: allItems.length,
      incomplete,
    };
  } catch (error) {
    console.error("Failed to fetch library items:", error);
    return { items: [], totalRecordCount: 0 };
  }
}

// ─── Genres ──────────────────────────────────────────────────────

export async function fetchGenres(): Promise<{
  Items: { Name: string; Id: string }[];
}> {
  // Stremio doesn't have a direct genres endpoint.
  // We derive genres from catalog extra options if available.
  try {
    const addons = await getInstalledAddons();
    const genreSet = new Set<string>();

    for (const addon of addons) {
      for (const catalog of addon.manifest.catalogs) {
        const genreExtra = catalog.extra?.find((e) => e.name === "genre");
        if (genreExtra?.options) {
          genreExtra.options.forEach((g) => genreSet.add(g));
        }
      }
    }

    return {
      Items: Array.from(genreSet).map((name) => ({ Name: name, Id: name })),
    };
  } catch (error) {
    console.error("Failed to fetch genres:", error);
    return { Items: [] };
  }
}

export async function fetchGenre(
  genreName: string
): Promise<{ Name: string; Id: string } | null> {
  const genres = await fetchGenres();
  const target = genreName.trim().toLowerCase();
  return (
    genres.Items.find((genre) => genre.Name.toLowerCase() === target) || null
  );
}

// ─── Playback Reporting ──────────────────────────────────────────
// Playback state is synced via datastorePut/libraryItem updates.

const WATCHED_THRESHOLD_COEF = 0.7;
const CREDITS_THRESHOLD_COEF = 0.9;

type PlaybackMediaType = "movie" | "series";
type PlaybackReportKind = "start" | "progress" | "stopped";
export type PlaybackReportResult = boolean | { retryAfterMs: number };

function playbackRequestFailure(response: Response): PlaybackReportResult {
  const value = response.headers?.get("Retry-After");
  if (!value) return false;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? { retryAfterMs: delay } : false;
}

export interface PlaybackReportInput {
  libraryItemId: string;
  videoId?: string;
  mediaType: PlaybackMediaType;
  mediaName: string;
  poster?: string;
  currentTimeSeconds: number;
  durationSeconds?: number;
  ended?: boolean;
  sessionId?: string;
  watchedTimeSeconds?: number;
}

type LibraryItemState = {
  lastWatched: string | null;
  timeWatched: number;
  timeOffset: number;
  overallTimeWatched: number;
  timesWatched: number;
  flaggedWatched: number;
  duration: number;
  video_id: string | null;
  watched: string | null;
  watchedEpisodes?: (number | boolean)[];
  noNotif: boolean;
  navigatorSessionId?: string;
  navigatorWatchedTime?: number;
};

type LibraryItemPayload = {
  _id: string;
  name: string;
  type: string;
  poster?: string | null;
  posterShape?: string;
  removed: boolean;
  temp: boolean;
  _ctime?: string;
  _mtime: string;
  state: LibraryItemState;
  behaviorHints?: Record<string, unknown>;
};

function toMilliseconds(seconds: number | undefined): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.floor(seconds * 1000));
}

function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value) => typeof value === "string" && value.length > 0) as
    | string
    | undefined;
}

async function upsertPlaybackState(
  kind: PlaybackReportKind,
  input: PlaybackReportInput
): Promise<PlaybackReportResult> {
  try {
    const { authKey } = await getAuthData();
    // The cloud key is the title ID, never an episode ID. Manual stream
    // selection and automatic selection must write the same record.
    let titleId = input.mediaType === "series" ? parseSeriesRouteId(input.libraryItemId).seriesId : input.libraryItemId;
    if (/^tmdb:[1-9]\d*$/.test(titleId)) titleId = await resolveTMDBPlaybackId(titleId, input.mediaType);
    input = { ...input, libraryItemId: titleId, videoId: input.videoId?.startsWith(`${input.libraryItemId}:`)
      ? titleId + input.videoId.slice(input.libraryItemId.length) : input.videoId };
    const nowIso = new Date().toISOString();
    const currentTimeMs = toMilliseconds(input.currentTimeSeconds);
    const durationMs = toMilliseconds(input.durationSeconds);

    const existingResponse = await fetch(`${STREMIO_API}/datastoreGet`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authKey,
        collection: "libraryItem",
        ids: [input.libraryItemId],
        all: false,
      }),
      cache: "no-store",
    });

    if (!existingResponse.ok) {
      console.error(
        "Failed to fetch existing playback item:",
        existingResponse.status
      );
      return playbackRequestFailure(existingResponse);
    }

    const existingData = await existingResponse.json();
    if (existingData?.error || !Array.isArray(existingData?.result)) return false;
    const existingItem = existingData.result.find((item: any) => (item?._id ?? item?.id) === input.libraryItemId) ?? null;

    const baseState: LibraryItemState = {
      ...existingItem?.state,
      lastWatched: firstString(existingItem?.state?.lastWatched) || nowIso,
      timeWatched: toPositiveInt(existingItem?.state?.timeWatched),
      timeOffset: toPositiveInt(existingItem?.state?.timeOffset),
      overallTimeWatched: toPositiveInt(existingItem?.state?.overallTimeWatched),
      timesWatched: toPositiveInt(existingItem?.state?.timesWatched),
      flaggedWatched: toPositiveInt(existingItem?.state?.flaggedWatched),
      duration: Math.max(
        toPositiveInt(existingItem?.state?.duration),
        durationMs
      ),
      video_id:
        firstString(existingItem?.state?.video_id, input.videoId) || null,
      watched: firstString(existingItem?.state?.watched) || null,
      ...(Array.isArray(existingItem?.state?.watchedEpisodes) ? { watchedEpisodes: existingItem.state.watchedEpisodes } : {}),
      noNotif: Boolean(existingItem?.state?.noNotif),
    };

    const previousWatchedVideo = input.mediaType === "series" && input.videoId && baseState.video_id
      && input.videoId !== baseState.video_id && baseState.flaggedWatched > 0 ? baseState.video_id : null;
    // When switching videos (episode context), reset per-video tracking.
    if (input.videoId && baseState.video_id && input.videoId !== baseState.video_id) {
      baseState.timeWatched = 0;
      baseState.timeOffset = 0;
      baseState.duration = durationMs;
      baseState.flaggedWatched = 0;
      baseState.video_id = input.videoId;
    } else if (input.videoId && !baseState.video_id) {
      baseState.video_id = input.videoId;
    }

    const previousOffset = baseState.timeOffset;
    // A new playback session can intentionally restart the same video at zero.
    const nextOffset = currentTimeMs;
    const reportedWatched = toMilliseconds(input.watchedTimeSeconds);
    const previousSessionTime = baseState.navigatorSessionId === input.sessionId
      ? toPositiveInt(baseState.navigatorWatchedTime) : 0;
    // New clients sample actual playback locally. Cumulative session counters
    // make retries idempotent even when a successful response was lost.
    const watchedDelta = input.sessionId && input.watchedTimeSeconds !== undefined
      ? Math.max(0, reportedWatched - previousSessionTime)
      : Math.min(Math.max(0, nextOffset - previousOffset), Math.max(0,
        Date.now() - (Date.parse(existingItem?._mtime || "") || Date.now())));
    if (input.sessionId) {
      baseState.navigatorSessionId = input.sessionId;
      baseState.navigatorWatchedTime = Math.max(previousSessionTime, reportedWatched);
    }

    baseState.lastWatched = nowIso;
    baseState.timeOffset = nextOffset;
    if (durationMs > 0) baseState.duration = durationMs;

    // Keep watched durations monotonic on progress updates.
    if (kind !== "start") {
      baseState.timeWatched = baseState.timeWatched + watchedDelta;
      baseState.overallTimeWatched = baseState.overallTimeWatched + watchedDelta;
    }

    const wasFlaggedWatched = baseState.flaggedWatched > 0;
    if (
      baseState.flaggedWatched === 0 &&
      baseState.duration > 0 &&
      baseState.timeWatched > baseState.duration * WATCHED_THRESHOLD_COEF
    ) {
      baseState.flaggedWatched = 1;
      baseState.timesWatched = baseState.timesWatched + 1;
    }

    // Keep per-episode history after the active video changes. Metadata order
    // matches Stremio's season/episode order, including season-zero specials.
    if (input.mediaType === "series" && input.videoId && (previousWatchedVideo
      || (baseState.flaggedWatched > 0 && (!wasFlaggedWatched || !baseState.watched)))) {
      const episodes = await fetchEpisodes(input.libraryItemId, undefined, undefined, false);
      const specials = /^tmdb:/.test(input.libraryItemId) ? await fetchEpisodes(input.libraryItemId, 0, undefined, false) : [];
      const ids = orderedEpisodeIds([...episodes, ...specials]);
      if (previousWatchedVideo) baseState.watched = markVideoWatched(baseState.watched, ids, previousWatchedVideo, baseState.watchedEpisodes);
      if (baseState.flaggedWatched > 0) baseState.watched = markVideoWatched(baseState.watched, ids, input.videoId, baseState.watchedEpisodes);
    }

    // Match Stremio behavior for completed playback when stopping near credits.
    if (
      kind === "stopped" &&
      input.ended &&
      baseState.duration > 0 &&
      currentTimeMs > baseState.duration * CREDITS_THRESHOLD_COEF
    ) {
      baseState.timeOffset = 0;
    }

    const poster = firstString(existingItem?.poster, input.poster);
    // Stremio sync needs a public image URL, not our app-relative redirect.
    const libraryPoster = !publicArtworkUrl(poster)
      ? await getTMDBArtwork(input.libraryItemId, input.mediaType, "poster")
      : poster;

    const payload: LibraryItemPayload = {
      ...existingItem,
      _id: input.libraryItemId,
      name: existingItem?.name || input.mediaName,
      type: existingItem?.type || input.mediaType,
      poster: libraryPoster || null,
      posterShape: firstString(existingItem?.posterShape) || "poster",
      removed: Boolean(existingItem?.removed ?? true),
      temp: Boolean(existingItem?.temp ?? true),
      _ctime: firstString(existingItem?._ctime) || nowIso,
      _mtime: nowIso,
      state: baseState,
      behaviorHints:
        existingItem?.behaviorHints && typeof existingItem.behaviorHints === "object"
          ? existingItem.behaviorHints
          : {},
    };

    const writeResponse = await fetch(`${STREMIO_API}/datastorePut`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authKey,
        collection: "libraryItem",
        changes: [payload],
      }),
      cache: "no-store",
    });

    if (!writeResponse.ok) {
      console.error("Failed to update playback state:", writeResponse.status);
      return playbackRequestFailure(writeResponse);
    }

    const writeData = await writeResponse.json();
    return !writeData?.error && (writeData?.result === true || writeData?.result?.success === true);
  } catch (error) {
    console.error("Failed to report playback state:", error);
    return false;
  }
}

export async function reportPlaybackStart(
  input: PlaybackReportInput
): Promise<PlaybackReportResult> {
  return upsertPlaybackState("start", input);
}

export async function reportPlaybackProgress(
  input: PlaybackReportInput
): Promise<PlaybackReportResult> {
  return upsertPlaybackState("progress", input);
}

export async function reportPlaybackStopped(
  input: PlaybackReportInput
): Promise<PlaybackReportResult> {
  return upsertPlaybackState("stopped", input);
}

export interface PlaybackProgressState {
  resumePositionTicks?: number;
  progressPercent?: number;
  totalDuration?: number;
  videoId?: string;
  completed?: boolean;
}

export async function fetchPlaybackProgress(
  libraryItemId: string,
  videoId?: string
): Promise<PlaybackProgressState | null> {
  try {
    const { authKey } = await getAuthData();
    const response = await fetch(`${STREMIO_API}/datastoreGet`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authKey,
        collection: "libraryItem",
        ids: [libraryItemId],
        all: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error("Failed to fetch playback progress:", response.status);
      return null;
    }

    const data = await response.json();
    if (data?.error || !Array.isArray(data?.result)) return null;
    const item = data.result.find((candidate: any) => (candidate?._id ?? candidate?.id) === libraryItemId);
    if (!item?.state) return null;

    const stateVideoId = firstString(item?.state?.video_id);
    // Episode detail pages should only show progress for their selected episode.
    if (videoId && stateVideoId && stateVideoId !== videoId) {
      return { videoId: stateVideoId };
    }

    const rawOffset = Number(item?.state?.timeOffset ?? 0);
    const rawDuration = Number(item?.state?.duration ?? 0);
    const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
    const duration = Number.isFinite(rawDuration) ? rawDuration : 0;

    const offsetInSeconds = offset / 1000;
    const durationInSeconds = duration / 1000;

    return {
      videoId: stateVideoId,
      completed: (Number(item.state.flaggedWatched) > 0 &&
        (offset === 0 || (duration > 0 && offset >= duration * CREDITS_THRESHOLD_COEF))) || undefined,
      resumePositionTicks: offsetInSeconds > 0 ? offsetInSeconds : undefined,
      totalDuration: durationInSeconds > 0 ? durationInSeconds : undefined,
      progressPercent:
        duration > 0 && offset > 0
          ? Math.max(0, Math.min(100, Math.round((offset / duration) * 100)))
          : undefined,
    };
  } catch (error) {
    console.error("Failed to fetch playback progress:", error);
    return null;
  }
}

function normalizeYear(value: unknown): number | undefined {
  const parsed = Number(value);
  const currentYear = new Date().getFullYear() + 1;
  return Number.isInteger(parsed) && parsed >= 1888 && parsed <= currentYear
    ? parsed : undefined;
}

/** Optional movie caption only. Never block the resume row on full details,
 * episode lists, or synopsis repair. The caller streams this behind Suspense. */
export async function fetchResumeMovieYear(mediaItemId: string): Promise<number | null> {
  try {
    const addons = await getInstalledAddons();
    return await Promise.any(addons
      .filter((addon) => addonSupportsResource(addon, "meta", "movie"))
      .map(async (addon) => {
        const data = await fetchAddonResource<StremioMetaResponse>(
          addon.transportUrl, `meta/movie/${encodeURIComponent(mediaItemId)}.json`,
        );
        const year = normalizeYear(data?.meta?.year)
          ?? normalizeYear(data?.meta?.releaseInfo?.match(/^\d{4}/)?.[0]);
        if (year === undefined) throw new Error("No movie year");
        return year;
      })).catch(() => null);
  } catch {
    return null;
  }
}

// ─── Resume Items ────────────────────────────────────────────────
// Stremio's continue watching is managed client-side or via libraryItems API.

export async function fetchResumeItems(): Promise<MediaItem[]> {
  try {
    const { authKey } = await getAuthData();
    const response = await fetch(`${STREMIO_API}/datastoreGet`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authKey,
        collection: "libraryItem",
        ids: [],
        all: true,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Resume library request failed (${response.status})`);
    }

    const data = await response.json();
    if (data?.error || !Array.isArray(data?.result)) throw new Error("Invalid library response");
    const rawLibraryItems: any[] = data.result;
    // Only resolve possible cross-provider duplicates. A name match selects
    // candidates for an external-ID check; it never establishes identity.
    const titleKey = (item: any) => `${item.type}:${String(item.name || "").trim().toLowerCase()}`;
    const imdbCandidates = new Set(rawLibraryItems.filter(item => /^tt\d+(?::\d+:\d+)?$/.test(item?._id ?? item?.id ?? "")).map(titleKey));
    const aliases = new Map<string, Promise<string>>();
    const normalized = await Promise.all(rawLibraryItems.map(async item => {
      const rawId = firstString(item?._id, item?.id);
      if (!rawId) return null;
      let id = item.type === "series" ? parseSeriesRouteId(rawId).seriesId : rawId;
      if (/^tmdb:[1-9]\d*$/.test(id) && imdbCandidates.has(titleKey(item)) && (item.type === "series" || item.type === "movie")) {
        const key = `${item.type}:${id}`;
        if (!aliases.has(key)) aliases.set(key, resolveTMDBPlaybackId(id, item.type).catch(() => id));
        id = await aliases.get(key)!;
      }
      const originalTitleId = item.type === "series" ? parseSeriesRouteId(rawId).seriesId : rawId;
      const videoId = item?.state?.video_id;
      return { ...item, id, _id: id, state: { ...item.state,
        ...(typeof videoId === "string" && videoId.startsWith(`${originalTitleId}:`)
          ? { video_id: id + videoId.slice(originalTitleId.length) } : {}),
      } };
    }));
    // Latest record wins, including removals and cleared resume positions.
    // Never match by title text: different releases can have the same name.
    const latest = new Map<string, any>();
    const modified = (item: any) => Date.parse(item?._mtime || item?.state?.lastWatched || "") || 0;
    for (const item of normalized) {
      if (!item) continue;
      const key = `${item.type}:${item.id}`;
      if (!latest.has(key) || modified(item) > modified(latest.get(key))) latest.set(key, item);
    }
    const libraryItems = [...latest.values()];
    const toNumberOrUndefined = (value: unknown): number | undefined => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const toResumeSeconds = (offsetValue: unknown): number | undefined => {
      const offset = toNumberOrUndefined(offsetValue);
      if (offset === undefined || offset <= 0) return undefined;

      // Stremio's library contract uses milliseconds at every duration.
      return offset / 1000;
    };
    // Matches Stremio core's continue-watching rules:
    // type !== "other", (!removed || temp), and state.timeOffset > 0.
    const resumeItems = libraryItems
      .filter((item: any) => {
        const type = item?.type;
        const removed = Boolean(item?.removed);
        const temp = Boolean(item?.temp);
        const timeOffset = Number(
          item?.state?.timeOffset ?? 0
        );

        return type !== "other" && (!removed || temp) && timeOffset > 0;
      })
      .sort((a: any, b: any) => {
        const aLastWatched = new Date(
          a?.state?.lastWatched ?? a?._mtime ?? 0
        ).getTime();
        const bLastWatched = new Date(
          b?.state?.lastWatched ?? b?._mtime ?? 0
        ).getTime();
        return bLastWatched - aLastWatched;
      })
      .map((item: any): MediaItem => ({
        id: item.id ?? item._id,
        type:
          item.type === "movie" || item.type === "series"
            ? item.type
            : "movie",
        name: item.name,
        poster: item.poster,
        background: item.background,
        year: normalizeYear(item?.year),
        releaseInfo:
          typeof item?.releaseInfo === "string" ? item.releaseInfo : undefined,
        resumePositionTicks: toResumeSeconds(
          item?.state?.timeOffset
        ),
        progressPercent:
          Number(item?.state?.duration ?? 0) > 0
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    (Number(
                      item?.state?.timeOffset ?? 0
                    ) /
                      Number(item?.state?.duration)) *
                      100
                  )
                )
              )
            : undefined,
      }))
      .slice(0, 24)
      .map((item: MediaItem) => {
        const raw = libraryItems.find(
          (candidate: any) => (candidate.id ?? candidate._id) === item.id
        );
        const rawState = raw?.state ?? {};
        const videoId = raw?.state?.video_id ?? raw?.state?.videoId;
        const episodeMatch =
          typeof videoId === "string" ? videoId.match(/:(\d+):(\d+)$/) : null;
        const seasonNumber = episodeMatch ? Number(episodeMatch[1]) : undefined;
        const episodeNumber = episodeMatch ? Number(episodeMatch[2]) : undefined;
        const seasonEpisodeLabel = episodeMatch
          ? `S${seasonNumber} • E${episodeNumber}`
          : null;

        return {
          ...item,
          mediaSourceId: typeof videoId === "string" ? videoId : undefined,
          seriesId: item.type === "series" ? item.id : undefined,
          showName: item.type === "series" ? item.name : undefined,
          // Carry an episode name already present in library state without
          // fetching metadata for every home/catalog card.
          episodeTitle: item.type === "series" ? firstString(rawState?.episodeTitle, rawState?.episode_title) : undefined,
          seasonNumber,
          episodeNumber,
          streamUrl: firstString(
            rawState?.stream?.url,
            rawState?.stream?.externalUrl,
            rawState?.streamUrl,
            rawState?.stream_url,
            rawState?.url
          ),
          subtitleFilename: firstString(
            rawState?.stream?.behaviorHints?.filename,
            rawState?.behaviorHints?.filename
          ),
          subtitleVideoSize: toNumberOrUndefined(
            rawState?.stream?.behaviorHints?.videoSize ??
              rawState?.behaviorHints?.videoSize
          ),
          progressLabel: seasonEpisodeLabel || undefined,
          releaseInfo: seasonEpisodeLabel || item.releaseInfo || undefined,
        };
      });

    return resolveArtworkList(resumeItems, true);
  } catch (error) {
    console.error("Failed to fetch resume items:", error);
    throw new Error("Could not refresh Continue Watching");
  }
}

// ─── Library Scan (No-op for Stremio) ────────────────────────────

export async function scanLibrary(): Promise<void> {
  // No server-side library scan in Stremio
}
