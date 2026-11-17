"use server";

import { getAuthData } from "@/lib/server/auth";

/** Clear only the resume position. Keep watched history and library membership. */
export async function removeFromContinueWatching(input: { id: string; type: "movie" | "series"; videoId?: string }): Promise<boolean> {
    if (!input || typeof input.id !== "string" || !input.id || input.id.length > 500
        || (input.type !== "movie" && input.type !== "series")
        || (input.videoId !== undefined && (typeof input.videoId !== "string" || input.videoId.length > 500))) return false;
    try {
        const { authKey } = await getAuthData();
        const ids = [input.id, ...(input.videoId?.startsWith(`${input.id}:`) ? [input.videoId] : [])];
        const read = await fetch("https://api.strem.io/api/datastoreGet", {
            method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authKey, collection: "libraryItem", ids, all: false }),
            cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        if (!read.ok) return false;
        const data = await read.json();
        if (data?.error || !Array.isArray(data?.result)) return false;
        const existing = data.result.filter((item: any) => ids.includes(item?._id ?? item?.id) && item.type === input.type)
            .sort((a: any, b: any) => (Date.parse(b._mtime) || 0) - (Date.parse(a._mtime) || 0))[0];
        if (!existing?.state) return false;
        // A stale card must not clear a different episode started elsewhere.
        if (input.videoId && existing.state.video_id && existing.state.video_id !== input.videoId) return false;
        const write = await fetch("https://api.strem.io/api/datastorePut", {
            method: "POST", redirect: "manual", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authKey, collection: "libraryItem", changes: [{
                ...existing, _mtime: new Date().toISOString(), state: { ...existing.state, timeOffset: 0 },
            }] }), cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        if (!write.ok) return false;
        const result = await write.json();
        return !result?.error && (result?.result === true || result?.result?.success === true);
    } catch { return false; }
}
