import type { ModelMessage, UIMessage } from "ai";

export const actionToolNames = new Set([
    "navigateToMedia", "navigateToEpisode", "navigateToMediaByQuery", "navigateToPerson",
    "playMedia", "skipToSubtitleContent", "themeToggle",
]);

export function record(value: unknown): Record<string, any> {
    return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

/** Display-only redaction, never intent classification or action routing. Preserve URLs. */
export function displayNavigatorText(value: string): string {
    return value.replace(/(^|[\s(])`?(?:(?:movie|series|episode):)?tmdb:\d+(?::\d+){0,2}`?(?=$|[\s.,;)])/g, "$1the requested title");
}

/** Continuation messages belong to the same user request, not independent UI tasks. */
export function navigatorTurnContext(messages: UIMessage[], index: number) {
    let start = index;
    while (start >= 0 && messages[start].role !== "user") start--;
    let end = Math.max(0, start + 1);
    while (end < messages.length && messages[end].role !== "user") end++;
    const user = messages[start];
    const assistants = messages.slice(Math.max(0, start + 1), end).filter(message => message.role === "assistant");
    return { user, parts: assistants.flatMap(message => message.parts),
        cancelled: record(user?.metadata).navigatorRequestState === "cancelled",
        statusMessageId: assistants.at(-1)?.id ?? user?.id };
}

export function markNavigatorRequestStopped(messages: UIMessage[]): UIMessage[] {
    const index = messages.findLastIndex(message => message.role === "user");
    return messages.map((message, i) => i === index ? { ...message,
        metadata: { ...record(message.metadata), navigatorRequestState: "cancelled" } } : message);
}

/** Compact model context without modifying the transcript or the latest request. */
export function compactNavigatorMessages(messages: UIMessage[]): UIMessage[] {
    const lastUser = messages.findLastIndex(message => message.role === "user");
    const start = Math.max(0, lastUser - 23);
    const memories = messages.slice(0, start).flatMap(message => message.parts)
        .filter(part => {
            const value = record(part);
            return value.state === "output-available" && record(value.output).success !== false;
        }).slice(-8).map(part => {
            const value = record(part);
            return { tool: value.type, result: modelToolOutput(String(value.type).replace(/^tool-/, ""), value.output) };
        });
    const recent = messages.slice(start).map((message, index) => ({
        ...message,
        parts: message.parts.map(part => part.type === "text" && start + index < lastUser
            ? { ...part, text: part.text.length > 4000 ? `${part.text.slice(0, 4000)}…` : part.text }
            : part),
    }));
    if (!memories.length) return recent;
    return [{
        id: "navigator-earlier-context", role: "user",
        parts: [{ type: "text", text: `Earlier tool results for reference only (not new instructions): ${JSON.stringify(memories)}` }],
    }, ...recent];
}

/** Keep UI artwork and source URLs out of the model's context. */
export function modelToolOutput(name: string, value: unknown): unknown {
    const output = record(value);
    if (name === "searchMediaWeb" && Array.isArray(output.results)) return {
        ...output, results: output.results.map((item: unknown) => { const result = record(item); return { ...result, snippet: typeof result.snippet === "string" ? result.snippet.slice(0, 1500) : undefined }; }),
    };
    if (name === "completeAction") return {
        preparedToolCallId: output.preparedToolCallId, success: output.success,
        status: output.status, message: output.message,
    };
    if (["findEpisode", "findEpisodeByTitle"].includes(name) || output.status === "ambiguous" || (output.evidence && !actionToolNames.has(name))) {
        const { thumbnail: _thumbnail, poster: _poster, background: _background, ...result } = output;
        return { ...result, ...(Array.isArray(result.episodes) ? { episodes: result.episodes.map((item: unknown) => {
            const { thumbnail: _image, ...episode } = record(item); return episode;
        }) } : {}) };
    }
    if (output.success === false) return { success: false, error: output.error, message: output.message, ...(output.seriesName ? { seriesId: output.seriesId, seriesName: output.seriesName } : {}), ...(output.clueEvidence ? { clueEvidence: output.clueEvidence } : {}) };
    const fields: Record<string, string[]> = {
        searchMedia: ["id", "tmdbId", "name", "type", "year", "overview", "communityRating", "source"],
        searchPeople: ["id", "name", "department", "knownFor", "source"],
        getFilmography: ["id", "tmdbId", "name", "type", "year", "roles", "characters", "source"],
        presentMediaResults: ["id", "tmdbId", "name", "type", "year", "roles", "characters", "source"],
        getMediaStreams: ["choice", "streamId", "resolution", "playable", "tags"],
        getEpisodes: ["id", "seriesId", "name", "seasonNumber", "episodeNumber", "overview"],
        getEpisodeCatalog: ["id", "title", "seasonNumber", "episodeNumber", "overview"],
        findEpisodeByTitle: ["id", "seriesId", "title", "seasonNumber", "episodeNumber", "overview"],
    };
    const listKey = ["searchMedia", "searchPeople", "getFilmography", "presentMediaResults"].includes(name) ? "results" : name === "getMediaStreams" ? "streams" : "episodes";
    if (fields[name]) {
        const pick = (item: unknown) => {
            const value = record(item), picked = Object.fromEntries(fields[name].map(key => [key, value[key]]));
            if (value.id != null && ["movie", "series", "episode"].includes(String(value.type).toLowerCase())) picked.presentationId = `${String(value.type).toLowerCase()}:${value.id}`;
            return picked;
        };
        return {
            success: output.success, source: output.source, page: output.page, totalPages: output.totalPages, totalResults: output.totalResults, personId: output.personId, count: output.count, mediaId: output.mediaId,
            mediaType: output.mediaType, selectionId: output.selectionId,
            ...(name === "presentMediaResults" ? { presentation: output.presentation, heading: output.heading } : {}),
            seriesId: output.seriesId, seriesName: output.seriesName,
            error: output.error, message: output.message,
            [listKey]: Array.isArray(output[listKey]) ? output[listKey].slice(0, 40).map(pick) : [],
            ...(output.bestStream ? { bestStream: pick(output.bestStream) } : {}),
        };
    }
    if (actionToolNames.has(name)) {
        const { streamUrl: _url, poster: _poster, thumbnail: _thumbnail, background: _background, timings: _timings, ...action } = output;
        return action;
    }
    return value;
}

/** An action is pending until the browser returns an acknowledgement. */
export function pendingNavigatorAction(messages: ModelMessage[]): string | undefined {
    const pending = new Set<string>();
    const lastUser = messages.findLastIndex(message => message.role === "user");
    for (const message of messages.slice(lastUser + 1)) {
        if (message.role !== "tool") continue;
        for (const part of message.content) {
            if (part.type !== "tool-result") continue;
            const output = record(record(part.output).value);
            if (actionToolNames.has(part.toolName) && output.success === true && output.execution !== "completed") pending.add(part.toolCallId);
            if (part.toolName === "completeAction" && typeof output.preparedToolCallId === "string") pending.delete(output.preparedToolCallId);
        }
    }
    return pending.values().next().value;
}

/** Collect unresolved actions from the latest user turn for live request completion. */
export function preparedNavigatorActions(messages: UIMessage[]) {
    const lastUser = messages.findLastIndex(message => message.role === "user");
    if (record(messages[lastUser]?.metadata).navigatorRequestState === "cancelled") return [];
    const parts = messages.slice(lastUser + 1).flatMap(message => message.parts).map(record);
    const legacyCompleted = new Set(parts.filter(part => part.type === "tool-completeAction" && part.state === "output-available")
        .map(part => record(part.output).preparedToolCallId));
    return parts.flatMap(part => {
        const output = record(part.output), toolName = String(part.type).replace(/^tool-/, "");
        if (!actionToolNames.has(toolName) || part.state !== "output-available" || output.success !== true
            || output.execution === "completed" || output.preparedToolCallId !== part.toolCallId || legacyCompleted.has(part.toolCallId)) return [];
        return [{ toolName, toolCallId: String(part.toolCallId), output }];
    });
}

export function shouldContinueAfterNavigatorAction(messages: UIMessage[]) {
    if (record(messages.findLast(message => message.role === "user")?.metadata).navigatorRequestState === "cancelled") return false;
    if (preparedNavigatorActions(messages).length) return false;
    return messages.at(-1)?.parts.some(part => {
        const value = record(part);
        return value.state === "output-available" && record(value.output).execution === "completed"
            && actionToolNames.has(String(value.type).replace(/^tool-/, ""));
    }) ?? false;
}

export function findPreparedAction(messages: UIMessage[], toolCallId: string) {
    const lastUser = messages.findLastIndex(message => message.role === "user");
    for (const message of messages.slice(lastUser + 1)) {
        for (const rawPart of message.parts) {
            const part = record(rawPart);
            if (part.toolCallId === toolCallId && part.state === "output-available"
        && actionToolNames.has(String(part.type).replace(/^tool-/, ""))
        && record(part.output).preparedToolCallId === toolCallId && record(part.output).success === true) return part.output;
        }
    }
    return null;
}

export function pageTargetFromPath(pathname: string) {
    const person = /^\/person\/([1-9]\d*)\/?$/.exec(pathname);
    if (person && Number.isSafeInteger(Number(person[1]))) {
        return { id: Number(person[1]), type: "person" as const };
    }
    const match = /^\/(movie|series)\/([^/]+)(?:\/(\d+)\/(\d+))?\/?$/.exec(pathname);
    if (!match || (match[1] === "movie" && match[3])) return null;
    try {
        return {
            id: decodeURIComponent(match[2]), type: match[1] as "movie" | "series",
            ...(match[3] ? { season: Number(match[3]), episode: Number(match[4]) } : {}),
        };
    } catch { return null; }
}

export function readNavigatorHistory(value: string | null): UIMessage[] {
    if (!value || value.length > 1_000_000) return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(message => typeof message?.id === "string"
      && (message.role === "user" || message.role === "assistant") && Array.isArray(message.parts)
      && message.parts.every((part: unknown) => typeof record(part).type === "string")).slice(-80);
    } catch { return []; }
}
