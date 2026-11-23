"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import MuxVideo from "@mux/mux-video-react";
import { Clapperboard } from "lucide-react";
import { formatTime } from "media-chrome/utils/time";
import { ArtworkImage } from "@/components/artwork-image";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import { desktopBridge } from "@/lib/desktop/bridge";
import type { Chapter } from "@/lib/media/chapters";
import { loadChapterImage } from "@/lib/media/chapter-preview-image";
import { BrowserPreviewFrames } from "@/lib/media/preview-frames";
import { RangePreviewFrames } from "@/lib/media/range-preview-frames";
import {
    selectionListClass, selectionMetadataText, selectionRowClass, selectionThumbnailClass, selectionTitleText,
} from "./player-selection-row-styles";

export type ChapterNavigation = {
    chapters: readonly Chapter[];
    media: HTMLVideoElement | null;
    source: string;
    onSeek(_time: number): void;
};

const noChapter = () => undefined;
const clockEvents = ["timeupdate", "seeked", "loadedmetadata"] as const;

const emptyImages: ReadonlyMap<number, string> = new Map();
const emptyTimes: readonly number[] = [];

const warmEvents = ["loadeddata", "playing", "canplay", "progress", "timeupdate", "seeked"] as const;
const maxImageChecks = 2;

function sampleTimes({ startTime, endTime }: Chapter) {
    const span = endTime - startTime;
    return [
        startTime + Math.min(2, span / 2),
        startTime + Math.min(4, span * 0.75),
        startTime + Math.min(7, span * 0.9),
        startTime,
    ];
}

export function useChapterPreviews(navigation: ChapterNavigation | undefined, chapters: readonly Chapter[], open: boolean, warm: boolean) {
    const source = navigation?.source;
    const media = navigation?.media;
    const controller = (media as unknown as MpvElementHandle | null)?.controller;
    const bridge = desktopBridge();
    const mux = !!source && /\.m3u8(?:[?#]|$)|^https:\/\/stream\.mux\.com\/[^/.?#]+(?:[?#]|$)/i.test(source);
    const manifest = mux || !!source && /\.mpd(?:[?#]|$)/i.test(source);
    const native = !manifest && (bridge?.capabilities?.nativePreviews || bridge?.platform === "android") ? controller : undefined;
    const [failedSource, setFailedSource] = useState<string>();
    const ranged = !native && !manifest && failedSource !== source && typeof VideoDecoder !== "undefined";
    const enabled = !!source && chapters.length > 0;
    const showDecoder = enabled && !native && !ranged && (warm || open);
    const decoderRef = useRef<HTMLVideoElement | null>(null);
    const [decoderAttached, setDecoderAttached] = useState(false);
    const attachDecoder = useCallback((node: unknown) => {
        decoderRef.current = node as HTMLVideoElement | null;
        setDecoderAttached(node !== null);
    }, []);
    const playback = useMemo(() => ({ source, media }), [source, media]);
    const [result, setResult] = useState<{ playback: typeof playback; frames: Map<number, string> }>();
    const cache = useRef(new Map<number, string>());
    const visible = useRef<readonly number[]>(emptyTimes);
    const plan = useRef({ chapters, open, warm });
    const pumpRef = useRef<(() => void) | null>(null);
    const showFrames = useCallback((times: readonly number[]) => {
        visible.current = times;
        pumpRef.current?.();
    }, []);

    useEffect(() => {
        const frames = new Map<number, string>();
        cache.current = frames;
        return () => frames.forEach(src => URL.revokeObjectURL(src));
    }, [playback]);

    useEffect(() => {
        plan.current = { chapters, open, warm };
        pumpRef.current?.();
    }, [chapters, open, warm]);

    useEffect(() => {
        if (!enabled || !source) return;
        const frames = cache.current;
        const abort = new AbortController();
        const { signal } = abort;
        const offsets = new Map<number, number>();
        const checking = new Set<number>();
        const failedWarm = new Set<number>();
        const failedVisible = new Set<number>();
        let pending: { start: number; time: number; index: number; last: boolean; foreground: boolean } | undefined;
        let idleRetry: ReturnType<typeof setTimeout> | undefined;
        let rangeFailed = false;

        function useFallbackWhenReady() {
            if (rangeFailed && !checking.size && !signal.aborted) setFailedSource(source);
        }

        function retryWhenIdle() {
            idleRetry ??= setTimeout(() => { idleRetry = undefined; pump(); }, 250);
        }

        async function finish(time: number, src: string | null | undefined) {
            const request = pending;
            if (signal.aborted || !request || request.time !== time) return;
            pending = undefined;
            if (src === undefined) { retryWhenIdle(); return; }
            const { start } = request;
            checking.add(start);
            // One decoder can start the next seek while the last JPEG is read
            // and checked for black frames. Bound that overlap.
            queueMicrotask(pump);
            const image = src ? await loadChapterImage(src, signal).catch(() => null) : null;
            if (signal.aborted) {
                if (image) URL.revokeObjectURL(image);
                return;
            }
            checking.delete(start);
            if (image) {
                frames.set(start, image);
                setResult({ playback, frames: new Map(frames) });
                offsets.delete(start);
            } else {
                if (!request.last) offsets.set(start, request.index + 1);
                else {
                    offsets.delete(start);
                    failedWarm.add(start);
                    if (request.foreground) failedVisible.add(start);
                }
            }
            if (rangeFailed) useFallbackWhenReady();
            else queueMicrotask(pump);
        }

        const range = ranged ? new RangePreviewFrames(source, (time, src) => {
            range?.cancel();
            void finish(time, src);
        }, () => {
            rangeFailed = true;
            useFallbackWhenReady();
        }, true) : undefined;
        const decoder = decoderRef.current;
        const browser = showDecoder && decoderAttached && decoder ? new BrowserPreviewFrames(decoder, (time, src, _videoFrame, unavailable) => {
            browser?.cancel(!!unavailable);
            void finish(time, src);
        }, false, !mux, !mux, 8_000) : undefined;
        if (browser && !mux && decoder) {
            decoder.crossOrigin = "anonymous";
            decoder.src = source;
        }

        function pump() {
            if (signal.aborted || rangeFailed || pending || idleRetry !== undefined
                || checking.size >= maxImageChecks || (!native && !range && !browser)) return;
            const { chapters, open, warm } = plan.current;
            const foreground = open ? visible.current : emptyTimes;
            const visibleChapter = foreground.length ? chapters.find(({ startTime }) =>
                foreground.includes(startTime) && !frames.has(startTime) && !checking.has(startTime) && !failedVisible.has(startTime)) : undefined;
            const canWarm = warm && media && media.readyState >= 2;
            const needsImage = ({ startTime }: Chapter) => !frames.has(startTime) && !checking.has(startTime) && !failedWarm.has(startTime);
            // Give every chapter one sample before retrying background misses.
            const chapter = visibleChapter ?? (canWarm
                ? chapters.find(chapter => !offsets.has(chapter.startTime) && needsImage(chapter)) ?? chapters.find(needsImage)
                : undefined);
            if (!chapter) return;

            // The native bridge has one interactive request slot. Let an active
            // scrub finish before borrowing it for another chapter.
            if (native?.previewBusy) {
                retryWhenIdle();
                return;
            }

            const times = sampleTimes(chapter);
            const start = chapter.startTime;
            const index = offsets.get(start) ?? 0;
            const time = times[index];
            pending = { start, time, index, last: index === times.length - 1, foreground: !!visibleChapter };
            if (native) {
                void native.previewIfIdle(time).then(src => finish(time, src), () => finish(time, null));
            } else if (range) range.want(time);
            else browser?.want(time);
        }

        pumpRef.current = pump;
        warmEvents.forEach(event => media?.addEventListener(event, pump));
        document.addEventListener("visibilitychange", pump);
        pump();
        return () => {
            abort.abort();
            clearTimeout(idleRetry);
            pumpRef.current = null;
            warmEvents.forEach(event => media?.removeEventListener(event, pump));
            document.removeEventListener("visibilitychange", pump);
            range?.dispose();
            browser?.dispose();
        };
    }, [decoderAttached, enabled, media, mux, native, playback, ranged, showDecoder, source]);

    return {
        images: result?.playback === playback ? result.frames : emptyImages,
        showFrames,
        decoder: showDecoder && (mux
            ? <MuxVideo ref={attachDecoder} src={source} muted playsInline preload="metadata" crossOrigin="anonymous"
                disableTracking aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute size-px opacity-0" />
            : <video ref={attachDecoder} muted playsInline preload="metadata" crossOrigin="anonymous"
                aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute size-px opacity-0" />),
    };
}

export function PlayerChapterChoices({ chapters, media, onSeek, images, showFrames }: ChapterNavigation & {
    images: ReadonlyMap<number, string>;
    showFrames(_times: readonly number[]): void;
}) {
    const list = useRef<HTMLUListElement>(null);
    const initialImages = useRef(images);
    const subscribe = useCallback((notify: () => void) => {
        clockEvents.forEach(event => media?.addEventListener(event, notify));
        return () => clockEvents.forEach(event => media?.removeEventListener(event, notify));
    }, [media]);
    const snapshot = useCallback(() => chapters.find(chapter => media && media.currentTime >= chapter.startTime
        && media.currentTime < chapter.endTime)?.startTime, [chapters, media]);
    const current = useSyncExternalStore(subscribe, snapshot, noChapter);

    useEffect(() => {
        const root = list.current;
        if (!root) return;
        const rows = Array.from(root.querySelectorAll<HTMLLIElement>("[data-chapter-start]"));
        const timeFor = (row: HTMLElement) => Number(row.dataset.chapterStart);
        const visible = new Set<number>();
        const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
            for (const entry of entries) {
                const time = timeFor(entry.target as HTMLElement);
                if (entry.isIntersecting) visible.add(time);
                else visible.delete(time);
            }
            showFrames([...visible]);
        }, { root: root.parentElement });
        if (observer) rows.forEach(row => observer.observe(row));
        else showFrames(rows.slice(0, 6).map(timeFor));
        return () => { observer?.disconnect(); showFrames(emptyTimes); };
    }, [chapters, showFrames]);

    return <div className="@container min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-4">
        <ul ref={list} className={selectionListClass}>
            {chapters.map(chapter => {
                const image = images.get(chapter.startTime);
                const selected = current === chapter.startTime;
                return <li key={chapter.startTime} data-chapter-start={chapter.startTime}>
                    <button type="button" aria-current={selected || undefined}
                        onClick={() => onSeek(chapter.startTime)}
                        className={selectionRowClass}>
                        <span className={selectionThumbnailClass}>
                            {image && <ArtworkImage src={image} alt="" draggable={false} fallbackText="" reveal={!initialImages.current.has(chapter.startTime)}
                                className="peer absolute inset-0 size-full object-cover data-[artwork-state=error]:invisible" />}
                            <Clapperboard aria-hidden="true" className="size-4 text-muted-foreground peer-data-[artwork-state=ready]:invisible" />
                        </span>
                        <span className="min-w-0">
                            <span className={`${selectionTitleText} block wrap-break-word`}>{chapter.text}</span>
                            <span className={`${selectionMetadataText} block tabular-nums`}>{formatTime(chapter.startTime)}</span>
                        </span>
                    </button>
                </li>;
            })}
        </ul>
    </div>;
}
