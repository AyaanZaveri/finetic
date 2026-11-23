import { tool } from "ai";
import { z } from "zod";
import { fetchSeasons, fetchEpisodes } from "@/app/actions/tv-shows";

function parseSeasonId(seasonId: string): { seriesId: string; seasonNumber?: number } {
    const trimmed = seasonId.trim();
    const match = trimmed.match(/^(.*):(\d+)$/);

    if (!match) {
        return { seriesId: trimmed };
    }

    const [, seriesId, seasonStr] = match;
    const parsedSeason = Number(seasonStr);
    if (!Number.isInteger(parsedSeason) || parsedSeason < 0) {
        return { seriesId: trimmed };
    }

    return { seriesId, seasonNumber: parsedSeason };
}

function formatReleaseDate(released?: string): string | null {
    if (!released) return null;

    const parsed = new Date(released);
    if (Number.isNaN(parsed.getTime())) {
        return released;
    }

    return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export const getSeasons = tool({
    description:
    "List seasons when the user wants to browse a show's seasons. Not needed for playback with known episode coordinates or 'first episode' (season 1, episode 1).",
    inputSchema: z.object({
        tvShowId: z.string().describe("The unique ID of the TV show"),
    }),
    execute: async ({ tvShowId }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        console.log("📺 [getSeasons] Tool called with tvShowId:", tvShowId);
        try {
            const seasons = await fetchSeasons(tvShowId, abortSignal);
            return {
                success: true,
                seasons: seasons.map((season) => ({
                    id: `${tvShowId}:${season.number}`,
                    name: season.name,
                    seasonNumber: season.number,
                    episodeCount: season.episodeCount,
                    overview: season.overview,
                    poster: season.poster,
                })),
                count: seasons.length,
            };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return {
                success: false,
                error: error instanceof Error ? error.message : "Season lookup failed.",
                seasons: [],
            };
        }
    },
});

export const getEpisodes = tool({
    description:
    "List episodes when the user wants to browse a season. seasonId is '<seriesId>:<seasonNumber>', e.g. 'tmdb:114294:1'. Not needed to play a known episode number or the first episode; call playMedia directly with coordinates.",
    inputSchema: z.object({
        seasonId: z.string().describe("The unique ID of the season"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(40).optional(),
    }),
    execute: async ({ seasonId, page = 1, limit = 40 }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        console.log(
            "📺 [getEpisodes] Tool called with seasonId:",
            seasonId
        );
        try {
            const { seriesId, seasonNumber } = parseSeasonId(seasonId);
            if (seasonNumber === undefined) {
                return {
                    success: false,
                    error:
            "Invalid seasonId. Expected format '<seriesId>:<seasonNumber>' (for example: 'tt0944947:1').",
                    episodes: [],
                };
            }

            const episodes = await fetchEpisodes(seriesId, seasonNumber, abortSignal);
            const sortedEpisodes = [...episodes].sort((a, b) => {
                if (a.season !== b.season) return a.season - b.season;
                return a.episode - b.episode;
            });
            const trimmedEpisodes = sortedEpisodes.slice((page - 1) * limit, page * limit);

            return {
                success: true,
                episodes: trimmedEpisodes.map((episode) => ({
                    id: episode.id,
                    type: "Episode",
                    seriesId,
                    name: episode.title,
                    episodeNumber: episode.episode,
                    seasonNumber: episode.season,
                    overview: episode.overview,
                    releaseInfo: formatReleaseDate(episode.released),
                    thumbnail: episode.thumbnail,
                    poster: episode.thumbnail ?? null,
                })),
                count: episodes.length,
                returnedCount: trimmedEpisodes.length,
                truncated: page * limit < episodes.length,
                page, totalResults: episodes.length, totalPages: Math.ceil(episodes.length / limit),
            };
        } catch (error) {
            abortSignal?.throwIfAborted();
            const { seasonNumber } = parseSeasonId(seasonId);
            return {
                success: false,
                error: error instanceof Error && error.message.includes("not found on TMDB") && seasonNumber !== undefined
                    ? `Season ${seasonNumber} was not found for this series.`
                    : error instanceof Error ? error.message : "TMDB episode lookup failed.",
                episodes: [],
            };
        }
    },
});
