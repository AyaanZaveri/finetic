"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { fetchPlaybackProgress, type PlaybackProgressState } from "@/app/actions/media";
import { getFollowingEpisodeForSeries } from "@/app/actions/tv-shows";
import { useAccountAccess } from "@/contexts/account-context";
import type { MediaToPlay } from "@/lib/atoms";
import { episodePlaybackTarget, resumePlaybackTarget, savedRegularEpisode } from "@/lib/media/resume-playback";
import { WATCH_HISTORY_CHANGED } from "@/lib/watch-history";
import type { MediaItem } from "@/types/stremio";

type OverviewPlayback = {
    target: MediaToPlay;
    progress: PlaybackProgressState | null;
    progressEpisode?: { season: number; episode: number };
    pending: boolean;
};

const SeriesOverviewPlayback = createContext<OverviewPlayback | null>(null);

export function useSeriesOverviewPlayback() {
    return useContext(SeriesOverviewPlayback);
}

export function SeriesOverviewPlaybackProvider({ show, children }: { show: MediaItem; children: ReactNode }) {
    const { authenticated } = useAccountAccess();
    const isOverview = useParams<{ episode?: string }>()?.episode === undefined;
    const { id, imdbId, name, videos, seasons, background, poster } = show;
    const [saved, setSaved] = useState<{ id: string; isOverview: boolean; playback: OverviewPlayback } | null>(null);
    const media = useMemo<MediaToPlay>(() => ({
        id, name, type: "series", seriesId: id, showName: name,
        backdropUrl: background || poster,
        ...(!seasons?.length || seasons.some(season => season.number === 1)
            ? { seasonNumber: 1, episodeNumber: 1 } : {}),
    }), [id, name, background, poster, seasons]);

    useEffect(() => {
        if (!authenticated) return;
        let generation = 0;
        const historyId = imdbId && /^tt\d+$/.test(imdbId) && /^tmdb:\d+$/.test(id) ? imdbId : id;
        const readProgress = (id: string) => fetchPlaybackProgress(id).catch(() => null);
        const load = async () => {
            const request = ++generation;
            let seriesId = historyId;
            let progress = await readProgress(historyId);
            if (request !== generation) return;
            if (!progress?.videoId && historyId !== id) {
                seriesId = id;
                progress = await readProgress(id);
                if (request !== generation) return;
            }
            const series = { ...media, id: seriesId, seriesId };
            const last = progress?.videoId ? savedRegularEpisode(seriesId, progress.videoId, videos ?? []) : undefined;
            let target = resumePlaybackTarget(series, progress?.completed ? null : progress, videos);
            if (!target.mediaSourceId && isOverview && last) {
                const following = progress?.completed
                    ? await getFollowingEpisodeForSeries(id, last.season, last.episode).catch(() => null)
                    : null;
                if (request !== generation) return;
                target = following ? episodePlaybackTarget(media, following) : episodePlaybackTarget(series, last);
            }
            setSaved({ id, isOverview, playback: { target, progress, progressEpisode: last, pending: false } });
        };
        const refresh = (event: Event) => {
            const changedId = (event as CustomEvent<{ id?: string }>).detail?.id;
            if (!changedId || changedId === id || changedId === historyId) void load();
        };
        void load();
        window.addEventListener(WATCH_HISTORY_CHANGED, refresh);
        window.addEventListener("focus", refresh);
        return () => {
            generation++;
            window.removeEventListener(WATCH_HISTORY_CHANGED, refresh);
            window.removeEventListener("focus", refresh);
        };
    }, [authenticated, id, imdbId, videos, media, isOverview]);

    const playback = authenticated && saved?.id === id && saved.isOverview === isOverview
        ? saved.playback : { target: media, progress: null, pending: authenticated };
    return <SeriesOverviewPlayback.Provider value={playback}>{children}</SeriesOverviewPlayback.Provider>;
}
