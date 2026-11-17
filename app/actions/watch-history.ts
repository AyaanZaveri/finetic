"use server";

import { getAuthData } from "@/lib/server/auth";
import { fetchEpisodes } from "./tv-shows";
import { orderedEpisodeIds, setVideoWatched, watchedVideoIds } from "@/lib/stremio-watched";
import { watchHistoryKey, type WatchHistoryItem, type WatchHistoryRequest, type WatchStatusInput } from "@/lib/watch-history";

/** One datastore call serves a batch of cards. Metadata is only needed for
 * series that already have encoded episode history. History only needs episode
 * ordering, so never resolve artwork here. Never infer whole-show completion. */
export async function fetchWatchedItems(requests: WatchHistoryRequest[]): Promise<Record<string, WatchHistoryItem> | null> {
    const valid = requests.slice(0, 100).filter(item => typeof item.id === "string" && item.id.length > 0 && item.id.length < 500
        && (item.type === "movie" || item.type === "series"));
    const selected = [...new Map(valid.map(item => [watchHistoryKey(item), item])).values()];
    if (!selected.length) return {};
    try {
        const { authKey } = await getAuthData();
        const response = await fetch("https://api.strem.io/api/datastoreGet", {
            method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authKey, collection: "libraryItem", ids: [...new Set(selected.map(item => item.id))], all: false }),
            cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data?.error || !Array.isArray(data?.result)) return null;
        const items = new Map<string, (typeof data.result)[number]>();
        for (const item of data.result) {
            const key = `${item.type}:${item._id || item.id}`;
            if (!items.has(key)) items.set(key, item);
        }
        const result: Record<string, WatchHistoryItem> = {};
        let next = 0;
        async function decode(request: WatchHistoryRequest) {
            const item = items.get(watchHistoryKey(request));
            const state = item?.state;
            const watched = new Set<string>();
            if (request.type === "series" && state) {
                if (state.watched || Array.isArray(state.watchedEpisodes)) {
                    const regular = await fetchEpisodes(request.id, undefined, undefined, false);
                    const specials = /^tmdb:/.test(request.id) ? await fetchEpisodes(request.id, 0, undefined, false) : [];
                    watchedVideoIds(state.watched, orderedEpisodeIds([...regular, ...specials]), state.watchedEpisodes)
                        .forEach(id => watched.add(id));
                }
                // Older Navigator playback recorded only this per-video flag.
                if (Number(state.flaggedWatched) > 0 && typeof state.video_id === "string") watched.add(state.video_id);
            }
            result[watchHistoryKey(request)] = {
                movieWatched: request.type === "movie" && (Number(state?.flaggedWatched) > 0 || Number(state?.timesWatched) > 0),
                watchedEpisodeIds: [...watched],
            };
        }
        // Each TMDB title can already fan out across four seasons. Two title
        // workers avoid serial title waterfalls without multiplying that budget
        // by every visible card. The shared cursor keeps a slow title from
        // blocking other workers; duplicate cards are decoded just once.
        await Promise.all(Array.from({ length: Math.min(2, selected.length) }, async () => {
            while (next < selected.length) await decode(selected[next++]);
        }));
        return result;
    } catch { return null; }
}

/** Update only the selected movie/episode, preserving other episodes and the
 * library item's membership, metadata, and unrelated playback state. */
export async function setWatchedStatus(input: WatchStatusInput): Promise<WatchHistoryItem | null> {
    if (!input || typeof input.id !== "string" || !input.id || input.id.length > 500
        || (input.type !== "movie" && input.type !== "series") || typeof input.watched !== "boolean"
        || typeof input.name !== "string" || !input.name || input.name.length > 1000
        || (input.type === "series" && (typeof input.videoId !== "string" || !input.videoId || input.videoId.length > 500))) return null;
    try {
        const { authKey } = await getAuthData();
        const response = await fetch("https://api.strem.io/api/datastoreGet", {
            method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authKey, collection: "libraryItem", ids: [input.id], all: false }),
            cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data?.error || !Array.isArray(data?.result)) return null;
        const existing = data.result.find((item: { _id?: string; id?: string }) => (item._id || item.id) === input.id);
        if (existing && existing.type !== input.type) return null;
        const now = new Date().toISOString();
        const state = {
            lastWatched: null, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0,
            timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false,
            ...existing?.state,
        };
        const watched = new Set<string>();
        if (input.type === "series") {
            const episodes = await fetchEpisodes(input.id, undefined, undefined, false);
            const specials = /^tmdb:/.test(input.id) ? await fetchEpisodes(input.id, 0, undefined, false) : [];
            const ids = orderedEpisodeIds([...episodes, ...specials]);
            if (!ids.includes(input.videoId!)) return null;
            watchedVideoIds(state.watched, ids, state.watchedEpisodes).forEach(id => watched.add(id));
            if (state.flaggedWatched > 0 && state.video_id) watched.add(state.video_id);
            // Migrate the latest per-video flag if older playback didn't save it.
            let encoded = state.watched;
            if (state.flaggedWatched > 0 && state.video_id) encoded = setVideoWatched(encoded, ids, state.video_id, true, state.watchedEpisodes);
            const updated = setVideoWatched(encoded, ids, input.videoId!, input.watched, state.watchedEpisodes);
            if (encoded && updated === encoded
                && setVideoWatched(encoded, ids, input.videoId!, !input.watched, state.watchedEpisodes) === encoded) return null;
            // An unmappable/corrupt history must not be silently replaced.
            const actual = new Set(watchedVideoIds(updated, ids));
            const expected = new Set(watched);
            if (input.watched) expected.add(input.videoId!);
            else expected.delete(input.videoId!);
            if (expected.size !== actual.size || [...expected].some(id => !actual.has(id))) return null;
            state.watched = updated;
            // New encoded history supersedes the legacy array.
            delete state.watchedEpisodes;
            if (input.watched) watched.add(input.videoId!);
            else watched.delete(input.videoId!);
            // Stremio's MarkVideoAsWatched changes the bitfield, not the
            // playback completion counter for the title.
            if (state.video_id === input.videoId) {
                state.flaggedWatched = input.watched ? 1 : 0;
                state.timeOffset = 0;
                if (!input.watched) state.timeWatched = 0;
            }
        } else {
            state.flaggedWatched = input.watched ? 1 : 0;
            state.timesWatched = input.watched ? Math.max(1, Number(state.timesWatched) || 0) : 0;
            state.timeOffset = 0;
            if (!input.watched) {
                state.timeWatched = 0;
                state.watched = null;
                delete state.watchedEpisodes;
            }
        }
        if (input.watched) state.lastWatched = now;
        const payload = {
            _id: input.id, name: input.name, type: input.type, poster: null, posterShape: "poster",
            removed: true, temp: true, _ctime: now, ...existing, _mtime: now, state,
        };
        const write = await fetch("https://api.strem.io/api/datastorePut", {
            method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authKey, collection: "libraryItem", changes: [payload] }),
            cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        if (!write.ok) return null;
        const result = await write.json();
        if (result?.error || (result?.result !== true && result?.result?.success !== true)) return null;
        return { movieWatched: input.type === "movie" && input.watched, watchedEpisodeIds: [...watched] };
    } catch { return null; }
}
