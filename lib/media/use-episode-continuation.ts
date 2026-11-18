"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { preload } from "react-dom";
import { publicArtworkUrl } from "@/lib/artwork";
import { useMetadataWarmup, useStreamQueries } from "@/components/stream-query-provider";
import { useSettings } from "@/contexts/settings-context";
import { EpisodeContinuation, shouldPrefetchEpisode, UP_NEXT_SECONDS } from "./episode-continuation";
import { fetchFollowingEpisode, prepareNextEpisode } from "./prefetch-next-episode";
import { preloadNextVideo, videoPreloadAllowed } from "./preload-next-video";
import { getPlaybackTitles } from "./playback-titles";
import { DEFAULT_PLAYBACK_PREFERENCES } from "./playback-preferences";
import type { MediaToPlay } from "@/lib/atoms";
import type { Episode } from "@/app/actions/tv-shows";

type PendingAutoplay = { owner: EpisodeContinuation };
const UP_NEXT_LEAD_IN_SECONDS = 8;

export function useEpisodeContinuation(options: {
  media: MediaToPlay | null; visible: boolean; native: boolean; time?: number; duration: number; creditsStart?: number;
  session?: MediaToPlay | null;
  mediaRef?: RefObject<HTMLVideoElement | null>;
  play(_media: MediaToPlay): void; beforeAdvance(_ended: boolean): void; finish(): void;
}) {
    const { playbackPreferences = DEFAULT_PLAYBACK_PREFERENCES } = useSettings();
    const streamQueries = useStreamQueries();
    const metadataWarmer = useMetadataWarmup();
    const latest = useRef(options);
    const autoplay = useRef(playbackPreferences.episodeAutoplay);
    useLayoutEffect(() => {
        latest.current = options;
        autoplay.current = playbackPreferences.episodeAutoplay;
    });
    const titles = options.media ? getPlaybackTitles(options.media, options.media.details || null) : null;
    const session = options.session;
    const id = options.media?.seriesId || options.media?.id;
    const season = titles?.season, episode = titles?.episodeNumber;
    const key = options.visible && titles?.isEpisode && id && season !== undefined && episode !== undefined ? `${id}:${season}:${episode}` : "";
    const [snapshot, setSnapshot] = useState<{ owner: string; next: Episode | null; busy: boolean }>({ owner: "", next: null, busy: false });
    const [countdown, setCountdown] = useState<{ request: PendingAutoplay; next: Episode; seconds: number } | null>(null);
    const [previewOwner, setPreviewOwner] = useState<EpisodeContinuation | null>(null);
    const dismissedPreview = useRef<EpisodeContinuation | null>(null);
    const pending = useRef<PendingAutoplay | null>(null);
    const ended = useRef<string | null>(null);
    const owner = useRef<{ key: string; session: typeof session; continuation: EpisodeContinuation } | null>(null);
    useEffect(() => {
        ended.current = null;
        pending.current = null;
        dismissedPreview.current = null;
        setCountdown(null);
        setPreviewOwner(null);
        if (!key) { owner.current = null; return; }
        const continuation = new EpisodeContinuation({
            current: () => latest.current.media!, season: season!, episode: episode!,
            isCurrent: () => {
                const current = latest.current;
                if (!current.visible || !current.media || current.session !== session) return false;
                const target = getPlaybackTitles(current.media, current.media.details || null);
                return `${current.media.seriesId || current.media.id}:${target.season}:${target.episodeNumber}` === key;
            },
            lookup: signal => fetchFollowingEpisode(id!, season!, episode!, signal),
            prepare: (media, signal) => prepareNextEpisode(media, options.native, signal, streamQueries?.create, streamQueries?.metadata?.details),
            warm: (media, signal) => preloadNextVideo(media, options.native, latest.current.duration, signal),
            beforeAdvance: value => latest.current.beforeAdvance(value),
            play: media => latest.current.play(media),
        });
        owner.current = { key, session, continuation };
        let cancelled = false;
        void continuation.next().then(next => {
            if (cancelled) return;
            setSnapshot({ owner: key, next, busy: false });
            if (next && latest.current.media) metadataWarmer?.enqueue({ ...latest.current.media,
                id: id!, seriesId: id!, mediaSourceId: next.id, seasonNumber: next.season, episodeNumber: next.episode,
                episodeTitle: next.title, name: next.title });
        });
        return () => { cancelled = true; continuation.dispose(); };
    }, [key, id, season, episode, options.native, session, streamQueries, metadataWarmer]);
    const next = snapshot.owner === key && owner.current?.session === session ? snapshot.next : null;
    const thumbnail = publicArtworkUrl(next?.thumbnail);
    useEffect(() => {
        if (playbackPreferences.episodeAutoplay && thumbnail) preload(thumbnail, { as: "image", fetchPriority: "low" });
    }, [playbackPreferences.episodeAutoplay, thumbnail]);
    useEffect(() => {
        if (!playbackPreferences.episodePrefetch && owner.current?.key === key) owner.current.continuation.cancelPrefetch();
    }, [key, playbackPreferences.episodePrefetch]);
    useEffect(() => {
        const node = options.mediaRef?.current;
        let previousPreview: EpisodeContinuation | null | undefined;
        const update = () => {
            const position = node?.currentTime ?? options.time ?? 0;
            const remaining = options.duration - position;
            const continuation = owner.current?.key === key && owner.current.session === session ? owner.current.continuation : null;
            const preview = autoplay.current && continuation?.active && !node?.ended && !node?.seeking
                && dismissedPreview.current !== continuation && ended.current !== key && remaining > 0
                && remaining <= Math.min(UP_NEXT_LEAD_IN_SECONDS, options.duration * 0.1) ? continuation : null;
            if (preview !== previousPreview) {
                previousPreview = preview;
                setPreviewOwner(preview);
            }
            if (node?.ended || (options.duration > 0 && remaining <= .1)) return;
            const canLoad = videoPreloadAllowed(node);
            // Compatibility checks themselves load/decode video. Give those
            // the same spare-bandwidth gate as the actual standby buffer.
            const checksVideo = !options.native && playbackPreferences.autoSelectWebStream;
            if (!videoPreloadAllowed(node, 5) && owner.current?.key === key) {
                if (checksVideo) owner.current.continuation.cancelPrefetch();
                else owner.current.continuation.suspendVideoPrefetch();
            }
            if (playbackPreferences.episodePrefetch && shouldPrefetchEpisode(position, options.duration, options.creditsStart)
        && (!checksVideo || canLoad) && owner.current?.key === key) void owner.current.continuation.prefetch(canLoad);
        };
        const dismissOnSeek = () => {
            const request = pending.current;
            if (!node || !request || owner.current?.key !== key || owner.current.session !== session
                || owner.current.continuation !== request.owner) return;
            const end = Number.isFinite(node.duration) ? node.duration : options.duration;
            if (end <= 0 || node.currentTime >= end - 0.1) return;
            pending.current = null;
            ended.current = null;
            setCountdown(null);
        };
        update();
        node?.addEventListener("seeking", dismissOnSeek);
        node?.addEventListener("seeked", dismissOnSeek);
        node?.addEventListener("timeupdate", update);
        node?.addEventListener("progress", update);
        node?.addEventListener("pause", update); node?.addEventListener("waiting", update); node?.addEventListener("seeking", update);
        node?.addEventListener("seeked", update);
        document.addEventListener("visibilitychange", update);
        return () => {
            node?.removeEventListener("seeking", dismissOnSeek);
            node?.removeEventListener("seeked", dismissOnSeek);
            for (const event of ["timeupdate", "progress", "pause", "waiting", "seeking", "seeked"]) node?.removeEventListener(event, update);
            document.removeEventListener("visibilitychange", update);
        };
    }, [key, session, options.time, options.duration, options.creditsStart, options.mediaRef, options.native, playbackPreferences.episodeAutoplay, playbackPreferences.episodePrefetch, playbackPreferences.autoSelectWebStream]);
    const advance = useCallback(async (automatic = false) => {
        const continuation = owner.current?.key === key && owner.current.session === session ? owner.current.continuation : null;
        if (!continuation?.active) return false;
        setSnapshot(previous => ({ ...previous, busy: true }));
        const started = await continuation.advance(automatic);
        if (!started && continuation.active) {
            setSnapshot(previous => ({ ...previous, busy: false }));
        }
        return started;
    }, [key, session]);
    const advanceAfterEnd = useCallback((continuation: EpisodeContinuation) => {
        void advance(true).then(started => {
            if (!started && continuation.active && !continuation.advanced) latest.current.finish();
        });
    }, [advance]);
    const resolveCountdown = useCallback((play: boolean) => {
        const continuation = pending.current?.owner;
        if (!continuation?.active || owner.current?.key !== key || owner.current.session !== session
            || owner.current.continuation !== continuation) return;
        pending.current = null;
        setCountdown(null);
        if (play) advanceAfterEnd(continuation);
        else latest.current.finish();
    }, [advanceAfterEnd, key, session]);
    useEffect(() => {
        if (!countdown || countdown.request !== pending.current || !countdown.request.owner.active) return;
        if (!playbackPreferences.episodeAutoplay) { resolveCountdown(false); return; }
        const timer = setTimeout(() => {
            if (countdown.request !== pending.current || !countdown.request.owner.active) return;
            if (countdown.seconds === 1) resolveCountdown(autoplay.current);
            else setCountdown({ ...countdown, seconds: countdown.seconds - 1 });
        }, 1000);
        return () => clearTimeout(timer);
    }, [countdown, playbackPreferences.episodeAutoplay, resolveCountdown]);
    const finishEpisode = (skipCredits: boolean) => {
        const continuation = owner.current?.key === key && owner.current.session === session ? owner.current.continuation : null;
        if (!key) { latest.current.finish(); return; }
        if (!continuation?.active || continuation.advanced || ended.current === key) return;
        ended.current = key;
        if (skipCredits) { advanceAfterEnd(continuation); return; }
        if (!autoplay.current || dismissedPreview.current === continuation) { latest.current.finish(); return; }
        const request = { owner: continuation };
        pending.current = request;
        if (next) {
            setCountdown({ request, next, seconds: UP_NEXT_SECONDS });
            return;
        }
        void continuation.next().then(next => {
            if (pending.current !== request || !continuation.active || continuation.advanced) return;
            if (!next || !autoplay.current) { resolveCountdown(false); return; }
            setCountdown({ request, next, seconds: UP_NEXT_SECONDS });
        });
    };
    const counting = countdown && countdown.request === pending.current && countdown.request.owner === owner.current?.continuation
        && owner.current.session === session && countdown.request.owner.active ? countdown : null;
    const preview = playbackPreferences.episodeAutoplay && next && previewOwner?.active && !pending.current
        && previewOwner === owner.current?.continuation && owner.current.session === session
        && ended.current !== key && dismissedPreview.current !== previewOwner ? { owner: previewOwner, next, seconds: null } : null;
    const upNext = counting || preview;
    return {
        next,
        busy: snapshot.owner === key && snapshot.busy,
        upNext: upNext && { ...upNext, thumbnail: publicArtworkUrl(upNext.next.thumbnail) },
        advance: () => {
            if (pending.current) resolveCountdown(true);
            else void advance();
        },
        playUpNext: () => {
            if (counting?.request === pending.current) resolveCountdown(true);
            else if (preview?.owner.active && ended.current !== key && dismissedPreview.current !== preview.owner) {
                ended.current = key;
                setPreviewOwner(null);
                advanceAfterEnd(preview.owner);
            }
        },
        cancelUpNext: () => {
            if (counting?.request === pending.current) resolveCountdown(false);
            else if (preview?.owner.active && ended.current !== key) {
                dismissedPreview.current = preview.owner;
                setPreviewOwner(null);
            }
        },
        onEnded: () => finishEpisode(false),
        skipCredits: key ? () => finishEpisode(true) : undefined,
    };
}
