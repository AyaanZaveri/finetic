import type { MediaToPlay } from "@/lib/atoms";
import { parseSeriesRouteId } from "@/lib/series-route";

export interface ResumeProgress {
    resumePositionTicks?: number;
    totalDuration?: number;
    videoId?: string;
}

export interface ResumeEpisode {
    id: string;
    season?: number;
    episode?: number;
    title?: string;
    name?: string;
    released?: string;
}

export function safeResumePosition(position?: number, duration?: number, episode = false): number | undefined {
    if (typeof position !== "number" || !Number.isFinite(position) || position <= 0) return;
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
        const endBuffer = episode ? Math.min(5, duration * 0.05) : 0;
        if (position >= duration - endBuffer) return;
    }
    return position;
}

export function formatResumePosition(seconds: number): string {
    const time = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const remaining = String(time % 60).padStart(2, "0");
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${remaining}` : `${minutes}:${remaining}`;
}

/** Only offer Resume for the selected episode, or the saved regular episode
 * on a show's overview. A show's progress must never leak onto another episode. */
export function resumePlaybackTarget(
    media: MediaToPlay,
    progress: ResumeProgress | null,
    episodes: ResumeEpisode[] = [],
): MediaToPlay {
    const fromStart = { ...media, resumePositionTicks: undefined };
    const position = safeResumePosition(progress?.resumePositionTicks, progress?.totalDuration, media.type === "series");
    if (position === undefined) return fromStart;
    if (media.type !== "series") return { ...media, resumePositionTicks: position };
    if (media.mediaSourceId) return progress?.videoId === media.mediaSourceId
        ? { ...media, resumePositionTicks: position } : fromStart;
    if (!progress?.videoId) return fromStart;
    const selected = episodes.find(episode => episode.id === progress.videoId);
    const parsed = parseSeriesRouteId(progress.videoId);
    const seriesId = media.seriesId || media.id;
    const season = selected?.season ?? parsed.season;
    const episode = selected?.episode ?? parsed.episode;
    if ((!selected && parsed.seriesId !== parseSeriesRouteId(seriesId).seriesId)
        || season === undefined || season < 1 || episode === undefined || episode < 1) return fromStart;
    const title = selected?.title || selected?.name;
    return {
        ...media, seriesId, showName: media.showName || media.name,
        name: title || media.name, episodeTitle: title,
        mediaSourceId: progress.videoId, seasonNumber: season, episodeNumber: episode,
        resumePositionTicks: position,
        streamUrl: undefined, requestHeaders: undefined, subtitleFilename: undefined, subtitleVideoSize: undefined,
    };
}
