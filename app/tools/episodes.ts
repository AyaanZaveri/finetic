import { tool, type LanguageModel } from "ai";
import { z } from "zod";
import { resolveEpisode, type EpisodeQuery, type EpisodeProgress } from "@/lib/episode-discovery";
import { getTinyfishConfig } from "@/lib/tinyfish-credentials";
import { researchMediaWeb } from "@/lib/tinyfish";
import { createEpisodeResearch } from "@/lib/episode-research";
import { navigateToEpisode, navigateToMedia, playMedia, playMediaInputSchema } from "./media";
import { getTMDBEpisode } from "@/lib/tmdb-discovery";
import { record } from "@/lib/navigator-chat";

const queryFields = {
    seriesId: z.string().optional().describe("Known TMDB/IMDb series ID; use instead of searching the title again"),
    seriesQuery: z.string().min(1).max(300).optional().describe("TV show title, when its ID is unknown"),
    episodeQuery: z.string().min(1).max(1500).describe("The user's episode title or plot/event/guest description, preserving distinctive details"),
    seasonNumber: z.number().int().min(0).optional().describe("Only when the user specifies the season"),
};

export function createEpisodeTools(model?: LanguageModel, originalRequest = "") {
    const research = createEpisodeResearch(model, originalRequest);
    const progress = (context: unknown) => record(context).onEpisodeProgress as ((_progress: EpisodeProgress) => void) | undefined;
    const resolve = async (input: EpisodeQuery, options: { abortSignal?: AbortSignal; context?: unknown }) => {
        const config = await getTinyfishConfig();
        const onProgress = record(options.context).onEpisodeProgress as ((_progress: EpisodeProgress) => void) | undefined;
        return resolveEpisode(input, { model, signal: options.abortSignal, onProgress,
            prefetchResearch: record(options.context).prefetchEpisodeResearch === true,
            research: config.enabled && config.apiKey ? (query, purpose, signal) => researchMediaWeb(query, purpose, config.apiKey!, signal, results => onProgress?.({ stage: "search", state: "completed", detail: query, sources: results.map(({ url, title }) => ({ url, title })) })) : undefined });
    };
    const findEpisode = tool({
        description: "Resolve an exact episode title against TMDB, with an optional user-specified season. For remembered scenes/events use getEpisodeCatalog, searchMediaWeb, readMediaWebSources and verifyEpisode so you control the research. Never guess coordinates from memory.",
        inputSchema: z.object(queryFields),
        execute: resolve,
    });
    return {
        findEpisode,
        getEpisodeCatalog: tool({
            description: "Inspect a show's TMDB episode catalog across all seasons without plot matching or web research. Use the returned real IDs to identify candidates, and page through the catalog when needed. Can run alongside an independent web search.",
            inputSchema: z.object({ seriesId: z.string(), page: z.number().int().min(1).optional(),
                seasonNumber: z.number().int().min(0).optional().describe("Only to inspect a known season; never infer a user restriction") }),
            execute: async ({ seriesId, page = 1, seasonNumber }, { abortSignal, context }) => {
                try {
                    const data = await research.catalog(seriesId, abortSignal, progress(context));
                    const episodes = seasonNumber === undefined ? data.episodes : data.episodes.filter(episode => episode.seasonNumber === seasonNumber);
                    const limit = 40;
                    return { success: true, source: "TMDB", seriesId: data.seriesId, seriesName: data.seriesName,
                        episodes: episodes.slice((page - 1) * limit, page * limit), page,
                        count: episodes.length, totalResults: episodes.length, totalPages: Math.ceil(episodes.length / limit) };
                } catch (error) {
                    abortSignal?.throwIfAborted();
                    return { success: false, episodes: [], error: error instanceof Error ? error.message : "Could not load the episode catalog." };
                }
            },
        }),
        verifyEpisode: tool({
            description: "Verify a remembered scene/event against source pages you already fetched and the real TMDB catalog. Does not search or fetch. Supply source IDs from readMediaWebSources, never snippets. Checks the original user request and reconstructs verbatim citations. Only a successful match authorizes verifiedEpisodeId for navigation/playback.",
            inputSchema: z.object({ seriesId: z.string(), episodeId: z.string(), episodeQuery: queryFields.episodeQuery,
                sourceIds: z.array(z.string()).min(1).max(8) }),
            execute: async (input, { abortSignal, context }) => {
                try {
                    const result = await research.verify(input, abortSignal, progress(context));
                    return { ...result, ...(result.success ? { verifiedEpisodeId: result.episodes[0].id } : {}) };
                }
                catch (error) {
                    abortSignal?.throwIfAborted();
                    return { success: false, error: error instanceof Error ? error.message : "Could not verify the episode evidence." };
                }
            },
        }),
        findEpisodeByTitle: tool({
            description: "Legacy episode lookup. Prefer findEpisode with episodeQuery for titles and descriptions.",
            inputSchema: z.object({ seriesQuery: z.string(), episodeTitle: z.string(), seasonNumber: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(10).optional() }),
            execute: (input, options) => resolve({ ...input, episodeQuery: input.episodeTitle }, options),
        }),
        navigateToEpisode: tool({
            description: "Open a TV episode. For an episode found by scene/event research, pass only verifiedEpisodeId from a successful verifyEpisode result. For an exact user-provided episode title pass seriesQuery/seriesId + episodeQuery. Explicit coordinates must come from the user or a verified tool result, never memory.",
            inputSchema: z.object({ ...queryFields, episodeQuery: queryFields.episodeQuery.optional(), episodeNumber: z.number().int().min(1).optional(),
                verifiedEpisodeId: z.string().optional() }),
            execute: async (input, options) => {
                if (input.verifiedEpisodeId) {
                    const proof = research.verified(input.verifiedEpisodeId);
                    if (!proof?.success) return { success: false, error: "Verify this episode with fetched evidence during this request before opening it." };
                    const episode = proof.episodes[0];
                    // Matching redundant fields do not alter the target; rejecting
                    // them costs a correction turn on otherwise valid model calls.
                    const sameTitle = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
                    if ((input.seriesId !== undefined && input.seriesId !== episode.seriesId)
                        || (input.seasonNumber !== undefined && input.seasonNumber !== episode.seasonNumber)
                        || (input.episodeNumber !== undefined && input.episodeNumber !== episode.episodeNumber)
                        || (input.seriesQuery !== undefined && !sameTitle(input.seriesQuery, episode.seriesName))
                        || (input.episodeQuery !== undefined && !sameTitle(input.episodeQuery, episode.title))) {
                        return { success: false, error: "The extra fields conflict with the verified selection. Pass only verifiedEpisodeId." };
                    }
                    const action = await navigateToMedia.execute!({ mediaId: episode.id, mediaType: "Episode" }, options);
                    return { ...action, mediaName: episode.title, mediaType: "Episode", seriesId: episode.seriesId,
                        seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
                        thumbnail: episode.thumbnail, evidence: proof.evidence };
                }
                if (input.episodeQuery) {
                    if (input.episodeNumber !== undefined) return { success: false, error: "Provide an episode description or explicit coordinates, not both." };
                    const resolved = await resolve({ ...input, episodeQuery: input.episodeQuery }, options);
                    if (!resolved.success) return resolved;
                    const episode = resolved.episodes[0];
                    const action = await navigateToMedia.execute!({ mediaId: episode.id, mediaType: "Episode" }, options);
                    return { ...action, mediaName: episode.title, mediaType: "Episode", seriesId: episode.seriesId,
                        seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
                        thumbnail: episode.thumbnail, evidence: resolved.evidence };
                }
                if (input.seasonNumber === undefined || input.episodeNumber === undefined) return { success: false, error: "Provide an episode description, or explicit season and episode numbers." };
                if (input.seriesId) {
                    const episode = await getTMDBEpisode(input.seriesId, input.seasonNumber, input.episodeNumber, options.abortSignal);
                    const action = await navigateToMedia.execute!({ mediaId: episode.id, mediaType: "Episode" }, options);
                    return { ...action, mediaName: episode.name, mediaType: "Episode", thumbnail: episode.thumbnail,
                        seasonNumber: input.seasonNumber, episodeNumber: input.episodeNumber };
                }
                if (!input.seriesQuery) return { success: false, error: "Provide the show title or its known series ID." };
                return navigateToEpisode.execute!({ seriesQuery: input.seriesQuery, seasonNumber: input.seasonNumber, episodeNumber: input.episodeNumber }, options);
            },
        }),
        playMedia: tool({
            description: `${playMedia.description} For a remembered episode, research and verify it first, then pass verifiedEpisodeId with the returned series mediaId and mediaType Episode. Exact-title lookup may use episodeQuery. Do not guess coordinates.`,
            inputSchema: playMediaInputSchema.extend({ episodeQuery: queryFields.episodeQuery.optional(), verifiedEpisodeId: z.string().optional() }),
            execute: async (input, options) => {
                if (input.verifiedEpisodeId) {
                    const proof = research.verified(input.verifiedEpisodeId);
                    if (!proof?.success) return { success: false, error: "Verify this episode with fetched evidence during this request before playing it." };
                    if (input.episodeQuery || input.episodeNumber !== undefined || input.seasonNumber !== undefined || input.streamId || input.streamUrl || input.selectionId || input.mediaSourceId || input.mediaType === "Movie") {
                        return { success: false, error: "A verified selection cannot be combined with another episode or stream selection." };
                    }
                    const episode = proof.episodes[0];
                    const action = await playMedia.execute!({ ...input, mediaId: episode.id, mediaName: proof.seriesName!, mediaType: "Episode",
                        seriesId: episode.seriesId, showName: proof.seriesName, episodeTitle: episode.title,
                        seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber }, options);
                    return { ...action, thumbnail: episode.thumbnail, evidence: proof.evidence };
                }
                if (!input.episodeQuery) return playMedia.execute!(input, options);
                if (input.mediaType === "Movie" || input.episodeNumber !== undefined || input.streamId || input.streamUrl || input.selectionId || input.mediaSourceId) {
                    return { success: false, error: "For episode discovery, provide the series ID and description without coordinates or stream selections." };
                }
                const resolved = await resolve({ seriesId: input.seriesId || input.mediaId, episodeQuery: input.episodeQuery, seasonNumber: input.seasonNumber }, options);
                if (!resolved.success) return resolved;
                const episode = resolved.episodes[0];
                const action = await playMedia.execute!({ ...input, mediaId: episode.id, mediaName: resolved.seriesName!,
                    mediaType: "Episode", seriesId: episode.seriesId, showName: resolved.seriesName,
                    episodeTitle: episode.title, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber }, options);
                return { ...action, thumbnail: episode.thumbnail, evidence: resolved.evidence };
            },
        }),
        searchMediaWeb: tool({
            description: "Fast TinyFish Search API: returns up to ten results in the search engine's original order with titles, snippets and URLs. No page fetching. Choose complementary short queries, correct likely typos, and select pages to read yourself. Can run alongside getEpisodeCatalog or another independent query. At most four searches per request; do not fetch pages just to list links.",
            inputSchema: z.object({ query: z.string().min(1).max(1500), question: z.string().min(1).max(1500).describe("The media-information question the sources must answer") }),
            execute: async ({ query, question }, { abortSignal, context }) => {
                const config = await getTinyfishConfig();
                if (!config.enabled || !config.apiKey) return { success: false, error: "Enable TinyFish web search and configure its API key in Settings to research this question." };
                const progress = record(context).onEpisodeProgress as ((_progress: EpisodeProgress) => void) | undefined;
                progress?.({ stage: "search", state: "running" });
                try {
                    const started = Date.now();
                    const results = await research.search(query, question, abortSignal);
                    progress?.({ stage: "search", state: results.length ? "completed" : "error", sources: results.map(({ url, title }) => ({ url, title })) });
                    return { success: !!results.length, results, count: results.length, searchMs: Date.now() - started, evidenceLevel: "search-results", ...(results.length ? {} : { error: "No search results found." }) };
                } catch (error) {
                    abortSignal?.throwIfAborted();
                    progress?.({ stage: "search", state: "error" });
                    return { success: false, error: error instanceof Error ? error.message : "Web search failed." };
                }
            },
        }),
        readMediaWebSources: tool({
            description: "Read selected public source URLs returned by searchMediaWeb when a claim needs page evidence. Fetch only the relevant pages, up to four per call. This is slower than search; do not call it just to list search results.",
            inputSchema: z.object({ urls: z.array(z.string().url()).min(1).max(4), question: z.string().min(1).max(1500) }),
            execute: async ({ urls, question }, { abortSignal, context }) => {
                const config = await getTinyfishConfig();
                if (!config.enabled || !config.apiKey) return { success: false, error: "Enable TinyFish web search and configure its API key in Settings." };
                const progress = record(context).onEpisodeProgress as ((_progress: EpisodeProgress) => void) | undefined;
                progress?.({ stage: "web", state: "running" });
                try {
                    const sources = await research.read(urls, question, abortSignal);
                    progress?.({ stage: "web", state: sources.length ? "completed" : "error", sources: sources.map(({ url, title }) => ({ url, title })) });
                    return { success: !!sources.length, sources, evidenceLevel: "page-content" };
                } catch (error) {
                    abortSignal?.throwIfAborted();
                    const message = error instanceof Error ? error.message : "Could not read these sources.";
                    progress?.({ stage: "web", state: "error", detail: message });
                    return { success: false, error: message };
                }
            },
        }),
    };
}
