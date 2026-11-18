import type { SubtitleSnapshot } from "@/lib/media/subtitle-snapshot";
// Import and re-export all tools
import type { JSONValue, LanguageModel, ToolSet } from "ai";
import type { SceneRequestContext } from "@/lib/navigator-scene-context";
import { actionToolNames, modelToolOutput, record } from "@/lib/navigator-chat";
import { completeAction } from "./browser-action";
import { searchPeople, getPersonDetails, getFilmography, navigateToPerson } from "./people";
import { createEpisodeTools } from "./episodes";
import {
    searchMedia,
    navigateToMedia,
    navigateToEpisode,
    findEpisodeByTitle,
    navigateToMediaByQuery,
    getMediaStreams,
    playMedia,
    getMediaDetails,
} from "./media";

import {
    getSeasons,
    getEpisodes,
} from "./tv-shows";

import {
    skipToSubtitleContent,
    createExplainScene,
    createAnalyzeMedia,
} from "./subtitles";

import {
    themeToggle,
} from "./theme";

import {
    createSystemPrompt,
} from "./system-prompt";
import { createPresentMediaResults, seedMediaResults } from "./presentation";
import { mediaResultTools, rememberMediaResults, successfulMediaResults, type MediaResult } from "@/lib/navigator-selection";

// Export all media-related tools
export {
    searchMedia,
    navigateToMedia,
    navigateToEpisode,
    findEpisodeByTitle,
    navigateToMediaByQuery,
    getMediaStreams,
    playMedia,
    getMediaDetails,
};

// Export all TV show-related tools
export {
    getSeasons,
    getEpisodes,
};

// Export subtitle tool factory functions
export {
    skipToSubtitleContent,
    createExplainScene,
    createAnalyzeMedia,
};

// Export theme tools
export {
    themeToggle,
};

// Export system prompt
export {
    createSystemPrompt,
};

// Factory function to create all tools with context
export function createAllTools(
    currentMedia: any,
    currentTimestamp?: number,
    analysisModel?: LanguageModel,
    abortSignal?: AbortSignal,
    sceneContext?: SceneRequestContext,
    historyParts: unknown[] = [],
    currentSubtitles?: SubtitleSnapshot
): ToolSet {
    // Never accept episode evidence from the client-supplied history/context.
    // This request-local sink is populated only after verifyEpisode executes successfully.
    const requestSceneContext: SceneRequestContext | undefined = sceneContext ? {
        ...sceneContext,
        verifiedEpisodeEvidence: [],
    } : undefined;
    const mediaResults = new Map<string, MediaResult>();
    seedMediaResults(mediaResults, historyParts);
    const baseTools = {
    // Media tools
        searchMedia,
        navigateToMedia,
        navigateToEpisode,
        findEpisodeByTitle,
        navigateToMediaByQuery,
        getMediaStreams,
        playMedia,
        getMediaDetails,
    
        // TV Show tools
        getSeasons,
        getEpisodes,
        searchPeople,
        getPersonDetails,
        getFilmography,
        navigateToPerson,

        // Theme tools
        themeToggle,
        presentMediaResults: createPresentMediaResults(mediaResults),
    };

    const definitions: ToolSet = {
        ...baseTools,
        ...createEpisodeTools(analysisModel, sceneContext?.originalRequest),
        // Keep schemas stable when replaying a conversation after playback closes.
        skipToSubtitleContent: skipToSubtitleContent(currentMedia ?? null, analysisModel, abortSignal, requestSceneContext, currentSubtitles),
        explainScene: createExplainScene(currentMedia ?? null, analysisModel, abortSignal, currentTimestamp, currentSubtitles),
        analyzeMedia: createAnalyzeMedia(currentMedia ?? null, analysisModel, abortSignal, currentTimestamp, currentSubtitles),
    };
    return {
        ...Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, {
            ...definition,
            execute: definition.execute ? async (input: unknown, options: Parameters<NonNullable<typeof definition.execute>>[1]) => {
                options.abortSignal?.throwIfAborted();
                const output = await definition.execute!(input, options);
                options.abortSignal?.throwIfAborted();
                if (mediaResultTools.has(name)) rememberMediaResults(mediaResults, successfulMediaResults(output));
                if (name === "verifyEpisode" && requestSceneContext && record(output).success === true
                    && record(output).status === "matched") {
                    const result = record(output);
                    const episodes = Array.isArray(result.episodes) ? result.episodes : [];
                    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
                    for (const item of evidence.slice(0, 4)) {
                        const proof = record(item);
                        const episodeId = typeof proof.episodeId === "string" ? proof.episodeId : "";
                        const quote = typeof proof.quote === "string" ? proof.quote.slice(0, 1200) : "";
                        const episode = episodes.map(record).find(value => value.id === episodeId);
                        const title = typeof episode?.title === "string" ? episode.title.slice(0, 200) : "";
                        if (!episodeId || !quote || !title || !episode) continue;
                        const existing = requestSceneContext.verifiedEpisodeEvidence!;
                        if (!existing.some(value => value.episodeId === episodeId && value.quote === quote)) existing.push({ episodeId, quote, title });
                    }
                    requestSceneContext.verifiedEpisodeEvidence = requestSceneContext.verifiedEpisodeEvidence!.slice(-12);
                }
                if (actionToolNames.has(name) && record(output).success === true) {
                    const { message: _message, ...action } = record(output);
                    return { ...action, preparedToolCallId: options.toolCallId, execution: "prepared" };
                }
                return output;
            } : undefined,
            toModelOutput: ({ output }: { output: unknown }) => ({ type: "json" as const, value: modelToolOutput(name, output) as JSONValue }),
        }])),
        completeAction,
    } satisfies ToolSet;
}
