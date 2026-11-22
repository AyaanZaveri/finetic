"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import MuxVideo from "@mux/mux-video-react";
import { Clapperboard } from "lucide-react";
import { formatTime } from "media-chrome/utils/time";
import { ArtworkImage } from "@/components/artwork-image";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import { desktopBridge } from "@/lib/desktop/bridge";
import type { Chapter } from "@/lib/media/chapters";
import { videoPreloadAllowed } from "@/lib/media/preload-next-video";
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
    const [openedSource, setOpenedSource] = useState<string>();
    useEffect(() => { if (open) setOpenedSource(source); }, [open, source]);
    // The video-element fallback is demand-only. Keep its decoded images alive
    // for this source after the first open, but don't seek it when closed.
    const showDecoder = enabled && !native && !ranged && (open || openedSource === source);
    const [decoder, setDecoder] = useState<HTMLVideoElement | null>(null);
    const attachDecoder = useCallback((node: unknown) => setDecoder(node as HTMLVideoElement | null), []);
    const [result, setResult] = useState<{ source: string; media: typeof media; frames: Map<number, string> }>();
    const visible = useRef<readonly number[]>(emptyTimes);
    const speculative = useRef<readonly number[]>(emptyTimes);
    const pumpRef = useRef<(() => void) | null>(null);
    const showFrames = useCallback((times: readonly number[]) => {
        visible.current = times;
        pumpRef.current?.();
    }, []);

    useEffect(() => {
        if (!enabled || !source) return;
        const frames = new Map<number, string>();
        setResult({ source, media, frames });
        const attempted = new Set<number>();
        let waiting: number | undefined;
        let cancelled = false;
        const finish = (time: number, src: string | null) => {
            if (cancelled || waiting !== time) return;
            if (src) {
                frames.set(time, src);
                if (frames.size > 48) {
                    const oldest = frames.keys().next().value!;
                    frames.delete(oldest);
                    attempted.delete(oldest);
                }
                setResult({ source, media, frames: new Map(frames) });
            }
            waiting = undefined;
            queueMicrotask(pump);
        };
        const range = ranged ? new RangePreviewFrames(source, finish, () => {
            if (!cancelled) {
                setResult(undefined);
                setFailedSource(source);
            }
        }) : undefined;
        const browser = showDecoder && decoder ? new BrowserPreviewFrames(decoder, finish, false, !mux, !mux) : undefined;
        if (browser && !mux && decoder) decoder.src = source;
        function pump() {
            if (cancelled || waiting !== undefined || (!native && !range && !browser)) return;
            const foreground = visible.current.find(time => !attempted.has(time));
            const background = foreground === undefined && speculative.current.length && (native || range) && videoPreloadAllowed(media, 5)
                ? speculative.current.find(time => !attempted.has(time)) : undefined;
            const time = foreground ?? background;
            if (time === undefined) return;
            attempted.add(time);
            waiting = time;
            if (native) {
                const request = foreground === undefined ? native.previewIfIdle(time) : native.preview(time);
                void request.then(src => {
                    if (cancelled) return;
                    // A scrub request can supersede background work. Allow
                    // the drawer to retry that frame when the row is visible.
                    if (!src && foreground === undefined) {
                        speculative.current = emptyTimes;
                        attempted.delete(time);
                    }
                    finish(time, src);
                }, () => finish(time, null));
            } else if (range) range.want(time);
            else browser?.want(time);
        }
        pumpRef.current = pump;
        pump();
        return () => {
            cancelled = true;
            pumpRef.current = null;
            range?.dispose();
            browser?.dispose();
        };
    }, [decoder, enabled, media, mux, native, ranged, showDecoder, source]);

    useEffect(() => {
        if (!warm || !media || !enabled || (!native && !ranged)) return;
        const check = () => pumpRef.current?.();
        const stop = () => {
            media.removeEventListener("timeupdate", check);
            speculative.current = emptyTimes;
        };
        const timer = setTimeout(() => {
            speculative.current = chapters.slice(0, 4).map(chapter => chapter.startTime);
            media.addEventListener("timeupdate", check);
            check();
        }, 1500);
        const deadline = setTimeout(stop, 20_000);
        return () => {
            clearTimeout(timer);
            clearTimeout(deadline);
            stop();
        };
    }, [chapters, enabled, media, native, ranged, warm]);

    return {
        images: result && result.source === source && result.media === media ? result.frames : emptyImages,
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
                            {image && <ArtworkImage src={image} alt="" draggable={false} fallbackText=""
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
