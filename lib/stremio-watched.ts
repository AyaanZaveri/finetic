import "server-only";
import { deflateSync, inflateSync } from "node:zlib";

/** Stremio's watched field: lastVideoId:anchorLength:base64(zlib(bytes)).
 * Bits are least-significant first, in season/episode/release order.
 * https://github.com/Stremio/stremio-watched-bitfield */
export function watchedVideoIds(serialized: unknown, videoIds: string[], legacy?: unknown): string[] {
    if (!serialized) return Array.isArray(legacy) ? videoIds.filter((_, i) => legacy[i] === true || legacy[i] === 1) : [];
    if (typeof serialized !== "string" || serialized.length > 100_000) return [];
    try {
        const parts = serialized.split(":");
        const packed = parts.pop()!;
        const length = Number(parts.pop());
        const anchor = videoIds.indexOf(parts.join(":"));
        if (anchor < 0 || !Number.isSafeInteger(length) || length < 1) return [];
        const values = inflateSync(Buffer.from(packed, "base64"), { maxOutputLength: 100_000 });
        const offset = length - anchor - 1;
        return videoIds.filter((_, i) => {
            const index = i + offset;
            return index >= 0 && Boolean((values[Math.floor(index / 8)] || 0) & (1 << (index % 8)));
        });
    } catch { return []; }
}

export function markVideoWatched(serialized: string | null, videoIds: string[], videoId: string, legacy?: unknown): string | null {
    return setVideoWatched(serialized, videoIds, videoId, true, legacy);
}

export function setVideoWatched(serialized: string | null, videoIds: string[], videoId: string, isWatched: boolean, legacy?: unknown): string | null {
    if (!videoIds.includes(videoId)) return serialized;
    // Preserve history if its anchor cannot be mapped to this provider's metadata.
    if (serialized && !videoIds.includes(serialized.split(":").slice(0, -2).join(":"))) return serialized;
    if (serialized) {
        try {
            if (serialized.length > 100_000) return serialized;
            const parts = serialized.split(":");
            const packed = parts.pop()!;
            const length = Number(parts.pop());
            if (!Number.isSafeInteger(length) || length < 1) return serialized;
            inflateSync(Buffer.from(packed, "base64"), { maxOutputLength: 100_000 });
        } catch { return serialized; }
    }
    const watched = new Set(watchedVideoIds(serialized, videoIds, legacy));
    if (isWatched) watched.add(videoId);
    else watched.delete(videoId);
    const bytes = Buffer.alloc(Math.ceil(videoIds.length / 8));
    let anchor = 0;
    videoIds.forEach((id, index) => {
        if (watched.has(id)) {
            bytes[Math.floor(index / 8)] |= 1 << (index % 8);
            anchor = index;
        }
    });
    return `${videoIds[anchor]}:${anchor + 1}:${deflateSync(bytes).toString("base64")}`;
}

export function orderedEpisodeIds(episodes: { id: string; season: number; episode: number; released?: string }[]): string[] {
    const releasedAt = (value?: string) => {
        const time = Date.parse(value || "");
        return Number.isFinite(time) ? time : Number.MIN_SAFE_INTEGER;
    };
    return [...episodes].sort((a, b) => a.season - b.season
        || a.episode - b.episode || releasedAt(a.released) - releasedAt(b.released)).map(episode => episode.id);
}
