import "server-only";
import type { LanguageModel } from "ai";
import { hasTMDBDiscovery } from "@/lib/discovery";
import { readEpisodeCatalog, readEpisodeCatalogTitle } from "@/lib/server/episode-catalog";
import { getTinyfishConfig } from "@/lib/tinyfish-credentials";
import { searchTinyfish, fetchMediaWebSources, type WebEvidence } from "@/lib/tinyfish";
import { verifyEpisodeSources, type EpisodeCandidate, type EpisodeProgress, type EpisodeResolution } from "@/lib/episode-discovery";

export interface EpisodeCatalog {
    seriesId: string;
    seriesName: string;
    episodes: EpisodeCandidate[];
    seasonCount: number;
    source: EpisodeCandidate["source"];
}

/** Request-local research tools: the agent plans retrieval; only fetched evidence can authorize a selection. */
export function createEpisodeResearch(model?: LanguageModel, originalRequest = "") {
    const catalogs = new Map<string, Promise<EpisodeCatalog>>();
    const pages = new Map<string, WebEvidence>();
    const selections = new Map<string, EpisodeResolution>();
    let nextSourceId = 1;
    let searches = 0;
    let reads = 0;
    const config = async () => {
        const settings = await getTinyfishConfig();
        if (!settings.enabled || !settings.apiKey) throw new Error("Enable TinyFish web search and configure its API key in Settings.");
        return settings.apiKey;
    };
    const catalog = async (seriesId: string, signal?: AbortSignal, onProgress?: (_progress: EpisodeProgress) => void): Promise<EpisodeCatalog> => {
        signal?.throwIfAborted();
        let pending = catalogs.get(seriesId);
        if (!pending) {
            pending = (async () => {
                onProgress?.({ stage: "episodes", state: "running" });
                const useTMDB = await hasTMDBDiscovery();
                const series = await readEpisodeCatalogTitle(seriesId, useTMDB, signal);
                const { numbers, episodes: raw } = await readEpisodeCatalog(series, useTMDB, undefined, signal);
                const source = useTMDB || series.id.startsWith("tmdb:") ? "TMDB" : "Cinemeta";
                const episodes: EpisodeCandidate[] = raw.map(item => ({ id: item.id, seriesId: series.id, seriesName: series.name,
                    title: item.title, name: item.title, seasonNumber: item.season, episodeNumber: item.episode,
                    overview: item.overview, thumbnail: item.thumbnail, source, type: "Episode" }));
                onProgress?.({ stage: "episodes", state: "completed", catalog: { seriesId: series.id, seriesName: series.name,
                    episodeCount: episodes.length, seasonCount: numbers.length, poster: series.poster, year: series.year,
                    communityRating: series.communityRating, genres: series.genres, overview: series.overview } });
                return { seriesId: series.id, seriesName: series.name, episodes, seasonCount: numbers.length, source };
            })();
            catalogs.set(seriesId, pending);
            pending.catch(() => { catalogs.delete(seriesId); });
        }
        return pending;
    };
    const search = async (query: string, purpose: string, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        if (searches >= 4) throw new Error("The web search budget for this request is exhausted. Use the evidence already collected or ask for another detail.");
        searches++;
        return searchTinyfish(query, purpose, await config(), signal);
    };
    const read = async (urls: string[], question: string, signal?: AbortSignal): Promise<WebEvidence[]> => {
        signal?.throwIfAborted();
        const unique = [...new Set(urls)];
        const missing = unique.filter(url => !pages.has(url));
        if (reads + missing.length > 8) throw new Error("The page-reading budget for this request is exhausted. Use the evidence already collected or ask for another detail.");
        if (missing.length) {
            reads += missing.length;
            const fetched = await fetchMediaWebSources(missing, question, await config(), signal, question);
            for (const page of fetched) {
                const previous = pages.get(page.url);
                pages.set(page.url, { ...page, id: previous?.id || `web:${nextSourceId++}` });
            }
            return [...unique.flatMap(url => pages.get(url) ? [pages.get(url)!] : []),
                ...fetched.flatMap(page => unique.includes(page.url) ? [] : [pages.get(page.url)!])];
        }
        return unique.map(url => pages.get(url)!);
    };
    const verify = async (input: { seriesId: string; episodeId: string; episodeQuery: string; sourceIds: string[] },
        signal?: AbortSignal, onProgress?: (_progress: EpisodeProgress) => void): Promise<EpisodeResolution> => {
        signal?.throwIfAborted();
        const failure = (message: string): EpisodeResolution => ({ success: false, status: "not_found", source: "TMDB", episodes: [], evidence: [], message, error: message });
        const sources = [...new Set(input.sourceIds)].map(id => [...pages.values()].find(page => page.id === id));
        if (!sources.length || sources.some(source => !source)) return failure("Read the supporting source pages first. Only source IDs fetched during this request can verify an episode.");
        const data = await catalog(input.seriesId, signal, onProgress);
        if (!data.episodes.some(episode => episode.id === input.episodeId)) return failure("Select an episode ID from the supplied catalog.");
        const result = await verifyEpisodeSources(data.episodes, sources as WebEvidence[], originalRequest || input.episodeQuery,
            { model, signal, onProgress });
        if (result.success && result.episodes[0].id !== input.episodeId) return failure("The sources verify a different episode. Inspect the catalog and correct the selected ID.");
        if (result.success) selections.set(input.episodeId, result);
        return result;
    };
    return { catalog, search, read, verify, verified: (episodeId: string) => selections.get(episodeId) };
}
