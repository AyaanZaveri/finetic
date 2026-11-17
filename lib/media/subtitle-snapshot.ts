import { z } from "zod";
import { parseSeriesRouteId } from "@/lib/series-route";
import type { CurrentMediaWithSource } from "@/lib/atoms";
import { subtitleTimestamp, type ParsedSubtitleEntry } from "./subtitle-content";

export const subtitleSnapshotSchema = z.object({
    mediaKey: z.string().max(5000),
    delay: z.number().finite().min(-30).max(30),
    track: z.object({ sdh: z.boolean().optional(), forced: z.boolean().optional(), label: z.string().max(1000), language: z.string().max(100),
        filename: z.string().max(2048).optional(), provider: z.string().max(1000).optional() }),
    cues: z.array(z.object({ timestamp: z.number().finite().nonnegative().max(604800),
        endTimestamp: z.number().finite().nonnegative().max(604800).optional(),
        timestampFormatted: z.string().max(100), text: z.string().max(16000) })).min(1).max(20000),
}).refine(value => value.cues.reduce((size, cue) => size + cue.text.length, 0) <= 1_000_000);
export type SubtitleSnapshot = z.infer<typeof subtitleSnapshotSchema>;

export function subtitleMediaKey(media: CurrentMediaWithSource): string {
    const source = media.mediaSourceId || media.id;
    const parsed = parseSeriesRouteId(source);
    return JSON.stringify([media.type, source, media.seasonNumber ?? parsed.season ?? null,
        media.episodeNumber ?? parsed.episode ?? null, media.subtitleFilename || "", media.subtitleVideoSize || 0]);
}

/** Match exact known aliases and coordinates, never a show title or coordinates alone. */
export function isCurrentSubtitleTarget(current: CurrentMediaWithSource | null, target: { id: string; type: string; seasonNumber?: number; episodeNumber?: number }): boolean {
    if (!current || current.type !== target.type) return false;
    if (target.type === "movie") return [current.id, current.mediaSourceId].includes(target.id);
    const parsed = parseSeriesRouteId(target.id);
    const playing = parseSeriesRouteId(current.mediaSourceId || current.id);
    if ((parsed.season !== undefined && target.seasonNumber !== undefined && parsed.season !== target.seasonNumber)
        || (parsed.episode !== undefined && target.episodeNumber !== undefined && parsed.episode !== target.episodeNumber)) return false;
    const season = target.seasonNumber ?? parsed.season, episode = target.episodeNumber ?? parsed.episode;
    return season !== undefined && episode !== undefined
        && season === (current.seasonNumber ?? playing.season) && episode === (current.episodeNumber ?? playing.episode)
        && [current.id, current.seriesId, current.mediaSourceId].some(id => id && parseSeriesRouteId(id).seriesId === parsed.seriesId);
}

/** Uploaded captions are untrusted reference text, not verified episode evidence. */
export function snapshotSubtitles(snapshot: SubtitleSnapshot | undefined, media: CurrentMediaWithSource | null): ParsedSubtitleEntry[] | undefined {
    if (!snapshot || !media || snapshot.mediaKey !== subtitleMediaKey(media)) return undefined;
    return snapshot.cues.map(cue => ({ ...cue, timestamp: Math.max(0, cue.timestamp + snapshot.delay),
        endTimestamp: cue.endTimestamp === undefined ? undefined : Math.max(0, cue.endTimestamp + snapshot.delay),
        timestampFormatted: subtitleTimestamp(cue.timestamp + snapshot.delay) }));
}
