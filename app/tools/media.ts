import { tool } from "ai";
import { resolveEpisode } from "@/lib/episode-discovery";
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getTMDBTitle, resolveTMDBPlaybackId } from "@/lib/tmdb-discovery";
import { hasTMDBDiscovery, searchDiscoveryTitles } from "@/lib/discovery";
import { fetchEpisodeDetails, fetchEpisodes } from "@/app/actions/tv-shows";

import {
    getStreamAddonTargets,
    fetchStreamsFromAddon,
    fetchMediaDetails,
} from "@/app/actions/media";
import {
    buildEpisodePath,
    parseSeriesRouteId,
} from "@/lib/series-route";

async function searchTitlePage(query: string, signal?: AbortSignal, type?: "movie" | "series", page = 1) {
    const found = await searchDiscoveryTitles(query, signal, type, page);
    if (found.results.length) return found;
    // Some models append the release year to the title. Repair an empty search
    // within the same tool call, while retaining the year as a hard constraint.
    // Never strip a number from a title that already has real search results.
    const dated = /^(.+?)\s+\(?((?:19|20)\d{2})\)?$/.exec(query.trim());
    if (!dated || Number(dated[2]) > new Date().getFullYear() + 1) return found;
    const fallback = await searchDiscoveryTitles(dated[1], signal, type, page);
    return { ...fallback, results: fallback.results.filter(item => String(item.year) === dated[2]) };
}

async function searchTitles(query: string, signal?: AbortSignal, type?: "movie" | "series") {
    return (await searchTitlePage(query, signal, type)).results;
}

async function playbackId(id: string, type: "Movie" | "Series" | "Episode", signal?: AbortSignal) {
    if (type !== "Episode") return resolveTMDBPlaybackId(id, type === "Movie" ? "movie" : "series", signal);
    const parsed = parseSeriesRouteId(id);
    if (!parsed.isEpisodeTarget || parsed.season === undefined || parsed.episode === undefined) throw new Error("Provide a known series ID with seasonNumber and episodeNumber, or an episode ID in '<seriesId>:<season>:<episode>' format.");
    const series = await resolveTMDBPlaybackId(parsed.seriesId, "series", signal);
    return `${series}:${parsed.season}:${parsed.episode}`;
}
export interface NavigateMediaTool {
  success: boolean;
  action: string;
  url?: string;
  message: string;
  error?: string;
}

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s]|_/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function scoreSeriesMatch(query: string, candidateName: string): number {
    const q = normalizeText(query);
    const name = normalizeText(candidateName);
    if (!q || !name) return 0;
    if (name === q) return 1_000;
    if (name.startsWith(q)) return 700;
    if (name.includes(q)) return 500;

    const qTokens = q.split(" ").filter(Boolean);
    const nTokens = name.split(" ").filter(Boolean);
    let score = 0;
    for (const token of qTokens) {
        if (nTokens.includes(token)) score += 120;
        else if (nTokens.some((n) => n.startsWith(token))) score += 60;
        else if (name.includes(token)) score += 30;
    }
    return score;
}

function scoreMediaMatch(
    query: string,
    candidate: { name: string; communityRating?: number; poster?: string },
    preferredTypeScore = 0
): number {
    const nameScore = scoreSeriesMatch(query, candidate.name);
    let qualityScore = 0;
    if (candidate.poster) qualityScore += 10;
    if (candidate.communityRating) {
        const rating = candidate.communityRating;
        if (!Number.isNaN(rating)) qualityScore += rating;
    }
    return nameScore + qualityScore + preferredTypeScore;
}

export interface PlayMediaTool {
  success: boolean;
  action: string;
  mediaId: string;
  mediaName: string;
  mediaType: "Movie" | "Series" | "Episode";
  streamId?: string;
  selectionId?: string;
  streamChoice?: number;
  streamUrl?: string;
  mediaSourceId?: string;
  subtitleFilename?: string;
  subtitleVideoSize?: number;
  seriesId?: string;
  showName?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  message: string;
}

interface StreamRegistryEntry {
  streamUrl: string;
  subtitleFilename?: string;
  subtitleVideoSize?: number;
  mediaId: string;
  mediaType: "Movie" | "Series" | "Episode";
  createdAt: number;
}

interface StreamSelectionEntry {
  mediaId: string;
  mediaType: "Movie" | "Series" | "Episode";
  createdAt: number;
  choices: Record<string, string>;
}

const STREAM_REGISTRY_TTL_MS = 30 * 60 * 1000;
const STREAM_REGISTRY_MAX_ENTRIES = 500;
const streamRegistry = new Map<string, StreamRegistryEntry>();
const streamSelectionRegistry = new Map<string, StreamSelectionEntry>();
const STREAM_REGISTRY_FILE_PATH = path.join(
    os.tmpdir(),
    "navigator-stream-registry.json"
);
let streamRegistryHydrated = false;

function cleanupExpiredStreams(now = Date.now()) {
    for (const [id, entry] of streamRegistry.entries()) {
        if (now - entry.createdAt > STREAM_REGISTRY_TTL_MS) {
            streamRegistry.delete(id);
        }
    }

    if (streamRegistry.size > STREAM_REGISTRY_MAX_ENTRIES) {
        const sortedByAge = [...streamRegistry.entries()].sort(
            (a, b) => a[1].createdAt - b[1].createdAt
        );
        const entriesToTrim = streamRegistry.size - STREAM_REGISTRY_MAX_ENTRIES;
        for (let i = 0; i < entriesToTrim; i += 1) {
            const entry = sortedByAge[i];
            if (entry) {
                streamRegistry.delete(entry[0]);
            }
        }
    }

    for (const [id, entry] of streamSelectionRegistry.entries()) {
        if (now - entry.createdAt > STREAM_REGISTRY_TTL_MS) {
            streamSelectionRegistry.delete(id);
        }
    }
}

async function hydrateStreamRegistry() {
    if (streamRegistryHydrated) return;
    streamRegistryHydrated = true;

    try {
        const raw = await fs.readFile(STREAM_REGISTRY_FILE_PATH, "utf8");
        const parsed = JSON.parse(raw) as
      | {
          version?: number;
          streams?: Array<[string, StreamRegistryEntry]>;
          selections?: Array<[string, StreamSelectionEntry]>;
        }
      | Array<[string, StreamRegistryEntry]>;

        if (Array.isArray(parsed)) {
            for (const [id, entry] of parsed) {
                if (!entry || !entry.streamUrl || !entry.createdAt) continue;
                streamRegistry.set(id, entry);
            }
        } else {
            for (const [id, entry] of parsed.streams ?? []) {
                if (!entry || !entry.streamUrl || !entry.createdAt) continue;
                streamRegistry.set(id, entry);
            }
            for (const [id, entry] of parsed.selections ?? []) {
                if (!entry || !entry.mediaId || !entry.mediaType || !entry.createdAt) {
                    continue;
                }
                streamSelectionRegistry.set(id, entry);
            }
        }
        cleanupExpiredStreams();
    } catch {
    // No persisted registry yet (first run) or unreadable cache; ignore safely.
    }
}

async function persistStreamRegistry() {
    cleanupExpiredStreams();
    const serialized = JSON.stringify({
        version: 2,
        streams: [...streamRegistry.entries()],
        selections: [...streamSelectionRegistry.entries()],
    });
    try {
        await fs.writeFile(STREAM_REGISTRY_FILE_PATH, serialized, "utf8");
    } catch {
    // Persistence is best-effort; in-memory map still serves same-process calls.
    }
}

function registerStreamSelection(input: {
  mediaId: string;
  mediaType: "Movie" | "Series" | "Episode";
  choices: Record<string, string>;
}): string {
    cleanupExpiredStreams();
    const selectionId = `sel_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;

    streamSelectionRegistry.set(selectionId, {
        mediaId: input.mediaId,
        mediaType: input.mediaType,
        createdAt: Date.now(),
        choices: input.choices,
    });

    return selectionId;
}

async function resolveSelectionChoice(input: {
  selectionId: string;
  streamChoice: number;
  mediaId: string;
  mediaType: "Movie" | "Series" | "Episode";
}): Promise<string | undefined> {
    await hydrateStreamRegistry();
    cleanupExpiredStreams();

    const selection = streamSelectionRegistry.get(input.selectionId);
    if (!selection) return undefined;
    if (selection.mediaId !== input.mediaId || selection.mediaType !== input.mediaType) {
        return undefined;
    }

    const mappedStreamId = selection.choices[String(input.streamChoice)];
    return mappedStreamId || undefined;
}

function registerStreamCandidate(input: {
  streamUrl: string;
  subtitleFilename?: string;
  subtitleVideoSize?: number;
  mediaId: string;
  mediaType: "Movie" | "Series" | "Episode";
}): string {
    cleanupExpiredStreams();
    const streamId = `strm_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;

    streamRegistry.set(streamId, {
        streamUrl: input.streamUrl,
        subtitleFilename: input.subtitleFilename,
        subtitleVideoSize: input.subtitleVideoSize,
        mediaId: input.mediaId,
        mediaType: input.mediaType,
        createdAt: Date.now(),
    });

    return streamId;
}

async function resolveStreamId(streamId: string): Promise<StreamRegistryEntry | null> {
    await hydrateStreamRegistry();
    cleanupExpiredStreams();
    const entry = streamRegistry.get(streamId);
    if (!entry) return null;

    const isExpired = Date.now() - entry.createdAt > STREAM_REGISTRY_TTL_MS;
    if (isExpired) {
        streamRegistry.delete(streamId);
        await persistStreamRegistry();
        return null;
    }

    return entry;
}

export interface EpisodeLookupTool {
  source?: "TMDB" | "Cinemeta";
  success: boolean;
  seriesId?: string;
  seriesName?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodes?: Array<{
    id?: string;
    type?: "Episode";
    name?: string;
    title: string;
    seasonNumber: number;
    episodeNumber: number;
    overview?: string | null;
  }>;
  message: string;
  error?: string;
}

export const searchMedia = tool({
    description:
    "Search for movies or TV shows by title. Returns title IDs for navigation and playback. For scene requests, call skipToSubtitleContent with mediaQuery directly; it searches internally. Do not use this when navigateToMediaByQuery or navigateToEpisode can directly resolve the request.",
    inputSchema: z.object({
        mediaType: z.enum(["Movie", "Series"]).optional().describe("Restrict to movies or TV shows when known"),
        page: z.number().int().min(1).max(500).optional().describe("Result page, starting at 1"),
        query: z.string().describe("The search term or media title to look for"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("Maximum number of results to return (default: 8)"),
    }),
    execute: async ({ query, mediaType, page = 1, limit = 8 }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        console.log("🔍 [searchMedia] Tool called with query:", query);
        try {
            const found = await searchTitlePage(query, abortSignal, mediaType === "Movie" ? "movie" : mediaType === "Series" ? "series" : undefined, page);
            const results = found.results;
            console.log("🔍 [searchMedia] Search results:", results);
            const ranked = results
                .map((item) => ({
                    item,
                    score: scoreMediaMatch(query, item),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map((entry) => entry.item);
            return {
                success: true,
                source: found.provider,
                results: ranked.map(item => ({ ...item, overview: item.description })),
                page: found.page, totalPages: found.totalPages, totalResults: found.totalResults,
                count: ranked.length,
            };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return {
                success: false,
                error: error instanceof Error ? error.message : "Title search failed.",
                results: [],
            };
        }
    },
});

export const navigateToMedia = tool({
    description:
    "Navigate to a known media item ID. Use this only when you already have a validated mediaId or explicit episode coordinates.",
    inputSchema: z.object({
        mediaId: z.string().describe("The unique ID of the media item"),
        mediaType: z
            .enum(["Movie", "Series", "Episode"])
            .describe("The type of media - Movie, Series (TV Show), or Episode"),
        seriesId: z
            .string()
            .optional()
            .describe("Series ID for episodes when available"),
        seasonNumber: z
            .number()
            .optional()
            .describe("Season number for episodes when available"),
        episodeNumber: z
            .number()
            .optional()
            .describe("Episode number for episodes when available"),
    }),
    execute: async ({
        mediaId,
        mediaType,
        seriesId,
        seasonNumber,
        episodeNumber,
    }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        console.log("🎯 [navigateToMedia] Tool called with:", {
            mediaId,
            mediaType,
            seriesId,
            seasonNumber,
            episodeNumber,
        });
        if (mediaType === "Episode" && seriesId && seasonNumber !== undefined && episodeNumber !== undefined) mediaId = `${seriesId}:${seasonNumber}:${episodeNumber}`;
        mediaId = await playbackId(mediaId, mediaType, abortSignal);
        if (mediaType === "Episode") seriesId = parseSeriesRouteId(mediaId).seriesId;
        let basePath: string;
        if (mediaType === "Movie") {
            basePath = "/movie";
        } else if (mediaType === "Series") {
            basePath = "/series";
        } else {
            if (seriesId && seasonNumber !== undefined && episodeNumber !== undefined) {
                return {
                    success: true,
                    action: "navigate",
                    url: buildEpisodePath(seriesId, seasonNumber, episodeNumber),
                    message: "Navigating to episode...",
                };
            }

            const parsed = parseSeriesRouteId(mediaId);
            if (parsed.isEpisodeTarget && parsed.season !== undefined && parsed.episode !== undefined) {
                return {
                    success: true,
                    action: "navigate",
                    url: buildEpisodePath(parsed.seriesId, parsed.season, parsed.episode),
                    message: "Navigating to episode...",
                };
            }

            return {
                success: false,
                action: "navigate",
                message: "Could not determine season/episode for navigation.",
                error:
          "Missing season/episode context. Provide seriesId, seasonNumber, and episodeNumber.",
            };
        }
        const url = `${basePath}/${encodeURIComponent(mediaId)}`;
        return {
            success: true,
            action: "navigate",
            url,
            message: `Navigating to ${mediaType.toLowerCase()}...`,
        };
    },
});

export const navigateToEpisode = tool({
    description:
    "Navigate to a TV episode when season and episode numbers are already known. This tool requires explicit seasonNumber and episodeNumber.",
    inputSchema: z.object({
        seriesQuery: z.string().describe("Series name to resolve to a series ID"),
        seasonNumber: z.number().int().min(0).describe("Season number (0 for specials)"),
        episodeNumber: z.number().int().min(1).describe("Episode number"),
    }),
    execute: async ({ seriesQuery, seasonNumber, episodeNumber }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        console.log("🎯📺 [navigateToEpisode] Tool called with:", {
            seriesQuery,
            seasonNumber,
            episodeNumber,
        });

        try {
            const results = await searchTitles(seriesQuery, abortSignal, "series");
            const seriesCandidates = results.filter((item) => item.type === "series");

            if (seriesCandidates.length === 0) {
                return {
                    success: false,
                    action: "navigate",
                    message: "Series not found.",
                    error: "No matching TV series found.",
                };
            }

            const bestSeries = seriesCandidates
                .map((item) => ({
                    item,
                    score: scoreSeriesMatch(seriesQuery, item.name),
                }))
                .sort((a, b) => b.score - a.score)[0]?.item;

            if (!bestSeries) {
                return {
                    success: false,
                    action: "navigate",
                    message: "Series not found.",
                    error: "Could not resolve a series ID.",
                };
            }

            const seasonEpisodes = await fetchEpisodes(bestSeries.id, seasonNumber, abortSignal);
            const matchedEpisode = seasonEpisodes.find(
                (episode) => episode.episode === episodeNumber
            );

            if (!matchedEpisode) return { success: false, action: "navigate", message: "Episode not found.", error: "No episode was found at those coordinates." };
            const selectedId = await resolveTMDBPlaybackId(bestSeries.id, "series", abortSignal);
            const url = buildEpisodePath(selectedId, seasonNumber, episodeNumber);
            return {
                success: true,
                action: "navigate",
                url,
                mediaId: selectedId,
                mediaName: bestSeries.name,
                mediaType: "Episode",
                seasonNumber,
                episodeNumber,
                poster: bestSeries.poster ?? null,
                thumbnail: matchedEpisode?.thumbnail ?? null,
                background: null,
                message: "Navigating to episode.",
            };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return {
                success: false,
                action: "navigate",
                message: "Episode navigation failed.",
                error:
          error instanceof Error
              ? error.message
              : "Failed to resolve series for episode navigation.",
            };
        }
    },
});

export const findEpisodeByTitle = tool({
    description:
    "Legacy episode lookup. Returns only supported metadata matches. Prefer findEpisode for semantic discovery and optional web evidence.",
    inputSchema: z.object({
        seriesQuery: z.string().describe("Series name to resolve to a series ID"),
        seasonNumber: z.number().int().min(1).optional().describe("Search only this season when known; avoids fetching every season"),
        episodeTitle: z.string().describe("Episode title to match"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Maximum number of ranked episode candidates to return (default: 10)"),
    }),
    execute: async ({ seriesQuery, episodeTitle, seasonNumber }, { abortSignal }) =>
        resolveEpisode({ seriesQuery, episodeQuery: episodeTitle, seasonNumber }, { signal: abortSignal }),
});

export const navigateToMediaByQuery = tool({
    description:
    "Open a title DETAILS PAGE, without playing it. Use for 'go to Interstellar' or 'open The Rookie'. Never use for play/watch/start requests: resolve the title with searchMedia and use playMedia instead. Scene/moment requests use skipToSubtitleContent. Resolve a movie or series title and navigate in one step.",
    inputSchema: z.object({
        mediaQuery: z.string().describe("Movie or series title to navigate to"),
        preferredType: z
            .enum(["Movie", "Series"])
            .optional()
            .describe("Preferred media type when ambiguous"),
    }),
    execute: async ({ mediaQuery, preferredType }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        console.log("🎯🔎 [navigateToMediaByQuery] Tool called with:", {
            mediaQuery,
            preferredType,
        });
        try {
            const results = await searchTitles(mediaQuery, abortSignal, preferredType === "Movie" ? "movie" : preferredType === "Series" ? "series" : undefined);
            const candidates = results.filter(
                (item) => item.type === "movie" || item.type === "series"
            );

            if (candidates.length === 0) {
                return {
                    success: false,
                    action: "navigate",
                    message: "Media not found.",
                    error: "No matching movie or series found.",
                };
            }

            const preferred = preferredType?.toLowerCase();
            const best = candidates
                .map((item) => {
                    const preferredTypeScore =
            preferred && item.type === preferred ? 150 : 0;
                    return {
                        item,
                        score: scoreMediaMatch(mediaQuery, item, preferredTypeScore),
                    };
                })
                .sort((a, b) => b.score - a.score)[0]?.item;

            if (!best) {
                return {
                    success: false,
                    action: "navigate",
                    message: "Media not found.",
                    error: "Could not resolve media ID.",
                };
            }

            const selectedId = await resolveTMDBPlaybackId(best.id, best.type, abortSignal);
            const url = `/${best.type === "movie" ? "movie" : "series"}/${encodeURIComponent(selectedId)}`;

            return {
                success: true,
                action: "navigate",
                url,
                mediaId: selectedId,
                mediaName: best.name,
                mediaType: best.type === "movie" ? "Movie" : "Series",
                poster: best.poster ?? null,
                thumbnail: best.poster ?? null,
                background: null,
                message: "Navigating.",
            };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return {
                success: false,
                action: "navigate",
                message: "Navigation failed.",
                error:
          error instanceof Error
              ? error.message
              : "Failed to resolve media ID for navigation.",
            };
        }
    },
});

export const playMediaInputSchema = z.object({
    mediaId: z.string().describe("Known TMDB/IMDb title ID, retaining the tmdb: prefix. For episodes, a series ID plus seasonNumber/episodeNumber is sufficient; an encoded episode ID also works."),
    mediaName: z.string().describe("The name of the media item"),
    mediaType: z
        .enum(["Movie", "Series", "Episode"])
        .describe("The type of media - Movie, Series (TV Show), or Episode"),
    streamId: z
        .string()
        .optional()
        .describe(
            "Short stream reference ID returned by getMediaStreams (preferred over streamUrl)"
        ),
    selectionId: z
        .string()
        .optional()
        .describe("Selection group ID returned by getMediaStreams"),
    streamChoice: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Numeric stream choice from getMediaStreams (1-based)"),
    streamUrl: z
        .string()
        .optional()
        .describe("Direct stream URL (legacy fallback; prefer streamId)"),
    mediaSourceId: z
        .string()
        .optional()
        .describe("Source-specific ID for playback (e.g. episode ID)"),
    subtitleFilename: z
        .string()
        .optional()
        .describe("Subtitle hint filename from the selected stream"),
    subtitleVideoSize: z
        .number()
        .optional()
        .describe("Subtitle hint video size from the selected stream"),
    seriesId: z
        .string()
        .optional()
        .describe("Series ID for episode playback context"),
    showName: z
        .string()
        .optional()
        .describe("Series name for episode playback context"),
    episodeTitle: z
        .string()
        .optional()
        .describe("Episode title when mediaType is Episode"),
    seasonNumber: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Episode season number when available"),
    episodeNumber: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Episode number when available"),
});

export const playMedia = tool({
    description:
    "For ordinary playback from the start/resume position. For a requested scene, use skipToSubtitleContent instead. Open the player immediately for a known title. The player fetches and selects streams itself, just like pressing Play on a media card. Do not call getMediaStreams first unless the user requests stream choices or a specific version/quality. For 'first episode', pass the known series mediaId, mediaType Episode, seasonNumber 1, episodeNumber 1; no season/episode listing is needed. Reuse IDs from prior search or filmography results.",
    inputSchema: playMediaInputSchema,
    execute: async ({
        mediaId,
        mediaName,
        mediaType,
        streamId,
        selectionId,
        streamChoice,
        streamUrl,
        mediaSourceId,
        subtitleFilename,
        subtitleVideoSize,
        seriesId,
        showName,
        episodeTitle,
        seasonNumber,
        episodeNumber,
    }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        const target = parseSeriesRouteId(mediaId);
        if (mediaType !== "Movie" && (target.isEpisodeTarget || (seasonNumber !== undefined && episodeNumber !== undefined))) {
            mediaType = "Episode";
        }
        if (mediaType === "Episode" && !target.isEpisodeTarget && seasonNumber !== undefined && episodeNumber !== undefined) {
            mediaId = `${seriesId || mediaId}:${seasonNumber}:${episodeNumber}`;
        }
        const episodeTarget = mediaType === "Episode" ? parseSeriesRouteId(mediaId) : undefined;
        // Resolve playback and display metadata together; never enumerate the season.
        const [resolvedMediaId, episodeDetails] = await Promise.all([
            playbackId(mediaId, mediaType, abortSignal),
            episodeTarget?.season !== undefined && episodeTarget.episode !== undefined && !episodeTitle
                ? fetchEpisodeDetails(episodeTarget.seriesId, episodeTarget.season, episodeTarget.episode, abortSignal)
                    .catch(() => { abortSignal?.throwIfAborted(); return undefined; })
                : undefined,
        ]);
        mediaId = resolvedMediaId;
        episodeTitle ||= episodeDetails?.title;
        if (mediaType === "Episode") {
            const episode = parseSeriesRouteId(mediaId);
            seriesId = episode.seriesId;
            seasonNumber = episode.season;
            episodeNumber = episode.episode;
            showName ||= mediaName;
            mediaSourceId = mediaId;
        } else if (mediaSourceId) mediaSourceId = await playbackId(mediaSourceId, parseSeriesRouteId(mediaSourceId).isEpisodeTarget ? "Episode" : mediaType, abortSignal);
        console.log("▶️ [playMedia] Tool called with:", {
            mediaId,
            mediaName,
            mediaType,
            streamId,
            selectionId,
            streamChoice,
            hasStreamUrl: Boolean(streamUrl),
            mediaSourceId,
        });

        let candidateStreamId: string | undefined = streamId;
        if (!candidateStreamId && selectionId && streamChoice) {
            candidateStreamId = await resolveSelectionChoice({
                selectionId,
                streamChoice,
                mediaId,
                mediaType,
            });
        }

        const resolved =
      !streamUrl && candidateStreamId
          ? await resolveStreamId(candidateStreamId)
          : null;
        const resolvedStreamUrl = streamUrl || resolved?.streamUrl;
        const resolvedSubtitleFilename = subtitleFilename || resolved?.subtitleFilename;
        const resolvedSubtitleVideoSize =
      subtitleVideoSize ?? resolved?.subtitleVideoSize;

        if (
            resolved &&
      (resolved.mediaId !== mediaId || resolved.mediaType !== mediaType)
        ) {
            return { success: false, action: "play", error: "The selected stream belongs to another title. Choose a stream for this title." };
        }

        return {
            success: true,
            action: "play",
            mediaId,
            mediaName,
            mediaType,
            streamId: candidateStreamId || undefined,
            streamUrl: resolvedStreamUrl,
            mediaSourceId,
            subtitleFilename: resolvedSubtitleFilename,
            subtitleVideoSize: resolvedSubtitleVideoSize,
            seriesId,
            showName,
            episodeTitle,
            thumbnail: episodeDetails?.thumbnail,
            seasonNumber,
            episodeNumber,
            message: resolvedStreamUrl
                ? `Playing ${mediaName}...`
                : `Playing ${mediaName}... (loading best available stream)`,
        };
    },
});

function detectStreamResolution(value: string): string | null {
    if (/\b2160p\b|\b4k\b/.test(value)) return "2160p";
    if (/\b1080p\b/.test(value)) return "1080p";
    if (/\b720p\b/.test(value)) return "720p";
    if (/\b480p\b/.test(value)) return "480p";
    return null;
}

function detectStreamTags(value: string): string[] {
    const tags: string[] = [];
    if (/\bhdr\b/.test(value)) tags.push("HDR");
    if (/\bdv\b|dolby[\s-]?vision/.test(value)) tags.push("DV");
    if (/\bweb[-\s]?dl\b|\bweb[-\s]?rip\b|\bweb\b/.test(value)) tags.push("WEB");
    if (/\bbluray\b|\bbdrip\b/.test(value)) tags.push("BLURAY");
    if (/\bremux\b/.test(value)) tags.push("REMUX");
    return tags;
}

function detectContainer(value: string): "mp4" | "mkv" | "webm" | "ts" | "unknown" {
    if (/\.(mp4|m4v)\b/.test(value)) return "mp4";
    if (/\.(mkv)\b/.test(value)) return "mkv";
    if (/\.(webm)\b/.test(value)) return "webm";
    if (/\.(ts|m2ts)\b/.test(value)) return "ts";
    return "unknown";
}

function detectVideoCodec(
    value: string
):
  | "h264"
  | "h265"
  | "av1"
  | "vp9"
  | "vp8"
  | "xvid"
  | "mpeg2"
  | "unknown" {
    if (/\b(avc|h\.?264|x264)\b/.test(value)) return "h264";
    if (/\b(hevc|h\.?265|x265)\b/.test(value)) return "h265";
    if (/\b(av1)\b/.test(value)) return "av1";
    if (/\b(vp9)\b/.test(value)) return "vp9";
    if (/\b(vp8)\b/.test(value)) return "vp8";
    if (/\b(xvid|divx)\b/.test(value)) return "xvid";
    if (/\b(mpeg2|mpeg-2)\b/.test(value)) return "mpeg2";
    return "unknown";
}

function detectAudioCodec(
    value: string
):
  | "aac"
  | "opus"
  | "ac3"
  | "eac3"
  | "dts"
  | "truehd"
  | "flac"
  | "mp3"
  | "unknown" {
    if (/\b(aac)\b/.test(value)) return "aac";
    if (/\b(opus)\b/.test(value)) return "opus";
    if (/\b(truehd|mlp)\b/.test(value)) return "truehd";
    if (/\b(dts(?:-hd)?|dca)\b/.test(value)) return "dts";
    if (/\b(ddp|e-?ac-?3|eac3)\b/.test(value)) return "eac3";
    if (/\b(ac-?3|dd5[._ ]?1|dolby\s*digital)\b/.test(value)) return "ac3";
    if (/\b(flac)\b/.test(value)) return "flac";
    if (/\b(mp3)\b/.test(value)) return "mp3";
    return "unknown";
}

function scoreStreamCandidate(input: {
  raw: string;
  hasPlayableUrl: boolean;
  videoSize?: number | null;
}): number {
    const { raw, hasPlayableUrl, videoSize } = input;
    if (!hasPlayableUrl) return -10_000;

    let score = 100;
    const resolution = detectStreamResolution(raw);
    if (resolution === "1080p") score += 320;
    if (resolution === "720p") score += 220;
    if (resolution === "480p") score += 120;

    const tags = detectStreamTags(raw);
    if (tags.includes("WEB")) score += 40;

    const container = detectContainer(raw);
    if (container === "mp4") score += 140;
    if (container === "webm") score += 80;
    if (container === "mkv") score -= 40;
    if (container === "ts") score -= 20;

    const videoCodec = detectVideoCodec(raw);
    if (videoCodec === "h264") score += 180;
    if (videoCodec === "vp9") score += 110;
    if (videoCodec === "av1") score += 60;
    if (videoCodec === "vp8") score += 40;
    if (videoCodec === "h265") score -= 120;
    if (videoCodec === "xvid") score -= 220;
    if (videoCodec === "mpeg2") score -= 180;

    const audioCodec = detectAudioCodec(raw);
    if (audioCodec === "aac") score += 120;
    if (audioCodec === "opus") score += 90;
    if (audioCodec === "ac3") score += 60;
    if (audioCodec === "eac3") score += 30;
    if (audioCodec === "mp3") score += 20;
    if (audioCodec === "flac") score -= 50;
    if (audioCodec === "dts") score -= 180;
    if (audioCodec === "truehd") score -= 250;

    if (/\b(?:cam|hdcam|telesync|ts)\b/.test(raw)) score -= 500;
    if (/\b(?:3d)\b/.test(raw)) score -= 30;
    if (/\b(?:dubbed)\b/.test(raw)) score -= 20;
    if (/\b(?:10bit|12bit)\b/.test(raw)) score -= 80;
    if (/\b(?:atmos)\b/.test(raw)) score -= 20;

    if (typeof videoSize === "number" && Number.isFinite(videoSize)) {
        const gb = videoSize / (1024 * 1024 * 1024);
        if (gb > 20) score -= 100;
        else if (gb > 14) score -= 55;
        else if (gb > 10) score -= 25;
        else if (gb >= 2.5 && gb <= 8.5) score += 25;
    }

    return score;
}

export const getMediaStreams = tool({
    description:
    "Fetch stream choices ONLY when the user asks to list/compare streams or requests a particular quality/version (for example 1080p). Ordinary play/watch/start requests must call playMedia directly and let the player fetch streams. Returns ranked candidates with compact streamId values (1080p and below, no HDR/DV/Blu-ray/Remux).",
    inputSchema: z.object({
        mediaId: z.string().describe("The stream source ID to fetch streams for"),
        mediaType: z
            .enum(["Movie", "Series", "Episode"])
            .describe("The media type context"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe("Maximum stream candidates to return (default: 20)"),
    }),
    execute: async ({ mediaId, mediaType, limit = 20 }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        mediaId = await playbackId(mediaId, mediaType, abortSignal);
        await hydrateStreamRegistry();
        console.log("🎞️ [getMediaStreams] Tool called with:", {
            mediaId,
            mediaType,
            limit,
        });

        try {
            const stremioType = mediaType === "Movie" ? "movie" : "series";
            const targets = await getStreamAddonTargets(stremioType);
            const streamResponses = await Promise.all(
                targets.map(async (target) => {
                    const streams = await fetchStreamsFromAddon(
                        mediaId,
                        stremioType,
                        target.transportUrl,
                        target.name,
                        abortSignal
                    );
                    return { target, streams };
                })
            );

            const seen = new Set<string>();
            const candidates = streamResponses.flatMap(({ target, streams }) =>
                streams
                    .map((stream) => {
                        const streamUrl = stream.url || stream.externalUrl || null;
                        const streamId = streamUrl
                            ? registerStreamCandidate({
                                streamUrl,
                                subtitleFilename: stream.behaviorHints?.filename || undefined,
                                subtitleVideoSize: stream.behaviorHints?.videoSize || undefined,
                                mediaId,
                                mediaType,
                            })
                            : null;
                        const raw = `${stream.title || ""} ${stream.name || ""} ${stream.behaviorHints?.filename || ""}`.toLowerCase();
                        const key = `${target.id}|${streamUrl || ""}|${stream.title || ""}|${stream.name || ""}`;
                        if (seen.has(key)) return null;
                        seen.add(key);
                        return {
                            addonId: target.id,
                            addonName: target.name,
                            streamId,
                            name: stream.name || null,
                            title: stream.title || null,
                            filename: stream.behaviorHints?.filename || null,
                            videoSize: stream.behaviorHints?.videoSize || null,
                            resolution: detectStreamResolution(raw),
                            tags: detectStreamTags(raw),
                            container: detectContainer(raw),
                            videoCodec: detectVideoCodec(raw),
                            audioCodec: detectAudioCodec(raw),
                            score: scoreStreamCandidate({
                                raw,
                                hasPlayableUrl: Boolean(streamId),
                                videoSize: stream.behaviorHints?.videoSize || null,
                            }),
                            playable: Boolean(streamId),
                        };
                    })
                    .filter(Boolean)
            );

            const ranked = candidates
                .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
            // Hard-filter: only streams the browser can actually play.
            // Exclude 4K (2160p), HDR, Dolby Vision, Blu-ray, and Remux encodings.
                .filter((candidate) => {
                    if (candidate.resolution === "2160p") return false;
                    const tags = candidate.tags ?? [];
                    if (tags.includes("HDR")) return false;
                    if (tags.includes("DV")) return false;
                    if (tags.includes("BLURAY")) return false;
                    if (tags.includes("REMUX")) return false;
                    if (candidate.audioCodec === "dts") return false;
                    if (candidate.audioCodec === "truehd") return false;
                    if (candidate.videoCodec === "xvid") return false;
                    if (candidate.videoCodec === "mpeg2") return false;
                    return true;
                })
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            const numbered = ranked.map((stream, index) => ({
                ...stream,
                choice: index + 1,
            }));

            const selectionId = registerStreamSelection({
                mediaId,
                mediaType,
                choices: numbered.reduce<Record<string, string>>((acc, stream) => {
                    if (stream.streamId) {
                        acc[String(stream.choice)] = stream.streamId;
                    }
                    return acc;
                }, {}),
            });

            const bestStream =
        numbered.find((stream) => stream.playable && stream.streamId) || null;

            await persistStreamRegistry();

            return {
                success: true,
                action: "getMediaStreams",
                mediaId,
                mediaType,
                selectionId,
                streamCount: numbered.length,
                addonCount: targets.length,
                streams: numbered,
                bestStream,
                message: bestStream
                    ? `Found ${ranked.length} stream candidates.`
                    : "No playable stream URLs found.",
            };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return {
                success: false,
                action: "getMediaStreams",
                mediaId,
                mediaType,
                streams: [],
                bestStream: null,
                message: "Failed to fetch streams.",
                error:
          error instanceof Error ? error.message : "Failed to fetch streams.",
            };
        }
    },
});

export const getMediaDetails = tool({
    description: "Get movie, TV show, or episode metadata, including available genres, cast, crew, ratings, and synopsis. Always provide mediaType when known. TMDB numeric IDs are scoped to movies or TV.",
    inputSchema: z.object({
        mediaId: z.string().describe("TMDB or IMDb ID returned by search; episodes use '<seriesId>:<season>:<episode>'"),
        mediaType: z.enum(["Movie", "Series", "Episode"]).optional(),
    }),
    execute: async ({ mediaId, mediaType }, { abortSignal }) => {
        try {
            if (mediaType === "Episode") {
                const parsed = parseSeriesRouteId(mediaId);
                if (!parsed.isEpisodeTarget || parsed.season === undefined || parsed.episode === undefined) throw new Error("Choose an episode returned by episode search.");
                const episode = await fetchEpisodeDetails(parsed.seriesId, parsed.season, parsed.episode, abortSignal);
                if (!episode) throw new Error("Episode not found.");
                return { success: true, details: { ...episode, name: episode.title, type: "episode" } };
            }
            const types = mediaType === "Movie" ? ["movie" as const] : mediaType === "Series" ? ["series" as const] : ["movie" as const, "series" as const];
            const useTMDB = await hasTMDBDiscovery();
            for (const type of types) {
                try {
                    const details = useTMDB ? await getTMDBTitle(mediaId, type, abortSignal)
                        : await fetchMediaDetails(mediaId, type, abortSignal);
                    if (details) return { success: true, details: { ...details,
                        rating: details.communityRating?.toFixed(1) || ("imdbRating" in details ? details.imdbRating : undefined) } };
                } catch (error) {
                    abortSignal?.throwIfAborted();
                    if (!(error instanceof Error) || !error.message.includes("not found")) throw error;
                }
            }
            throw new Error("Title not found.");
        } catch (error) {
            abortSignal?.throwIfAborted();
            return { success: false, error: error instanceof Error ? error.message : "Metadata lookup failed." };
        }
    },
});
