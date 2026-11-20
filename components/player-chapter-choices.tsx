"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import MuxVideo from "@mux/mux-video-react";
import { Clapperboard } from "lucide-react";
import { formatTime } from "media-chrome/utils/time";
import { ArtworkImage } from "@/components/artwork-image";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import { desktopBridge } from "@/lib/desktop/bridge";
import type { Chapter } from "@/lib/media/chapters";
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

export function PlayerChapterChoices({ chapters, media, source, onSeek }: ChapterNavigation) {
    const list = useRef<HTMLUListElement>(null);
    const decoder = useRef<HTMLVideoElement>(null);
    const controller = (media as unknown as MpvElementHandle | null)?.controller;
    const bridge = desktopBridge();
    const mux = /\.m3u8(?:[?#]|$)|^https:\/\/stream\.mux\.com\/[^/.?#]+(?:[?#]|$)/i.test(source);
    const manifest = mux || /\.mpd(?:[?#]|$)/i.test(source);
    const native = !manifest && (bridge?.capabilities?.nativePreviews || bridge?.platform === "android")
        ? controller : undefined;
    const [rangeFailed, setRangeFailed] = useState(false);
    const ranged = !native && !manifest && !rangeFailed && typeof VideoDecoder !== "undefined";
    const [images, setImages] = useState(new Map<number, string>());
    const attachDecoder = useCallback((node: unknown) => { decoder.current = node as HTMLVideoElement | null; }, []);
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
        const visible = new Set<number>();
        const attempted = new Set<number>();
        let waiting: number | undefined;
        let cancelled = false;
        setImages(previous => previous.size ? new Map() : previous);

        const finish = (time: number, src: string | null) => {
            if (cancelled || waiting !== time) return;
            if (src) setImages(previous => new Map(previous).set(time, src));
            waiting = undefined;
            queueMicrotask(pump);
        };
        const range = ranged ? new RangePreviewFrames(source, finish, () => {
            if (!cancelled) setRangeFailed(true);
        }) : undefined;
        const browser = decoder.current ? new BrowserPreviewFrames(decoder.current, finish, false, !mux, !mux) : undefined;
        if (browser && !mux && decoder.current) decoder.current.src = source;
        function pump() {
            if (cancelled || waiting !== undefined) return;
            const time = [...visible].find(value => !attempted.has(value));
            if (time === undefined) return;
            attempted.add(time);
            waiting = time;
            if (native) void native.preview(time).then(src => finish(time, src), () => finish(time, null));
            else if (range) range.want(time);
            else if (browser) browser.want(time);
            else finish(time, null);
        }
        const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
            for (const entry of entries) {
                const time = Number((entry.target as HTMLElement).dataset.chapterStart);
                if (entry.isIntersecting) visible.add(time);
                else visible.delete(time);
            }
            pump();
        }, { root: root.parentElement });
        if (observer) rows.forEach(row => observer.observe(row));
        else {
            rows.slice(0, 6).forEach(row => visible.add(Number(row.dataset.chapterStart)));
            pump();
        }
        return () => {
            cancelled = true;
            observer?.disconnect();
            if (waiting !== undefined) native?.cancelPreview();
            range?.dispose();
            browser?.dispose();
        };
    }, [chapters, mux, native, ranged, source]);

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
        {!native && !ranged && (mux
            ? <MuxVideo ref={attachDecoder} src={source} muted playsInline preload="auto" crossOrigin="anonymous"
                disableTracking aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute size-px opacity-0" />
            : <video ref={attachDecoder} src={source} muted playsInline preload="auto" crossOrigin="anonymous"
                aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute size-px opacity-0" />)}
    </div>;
}
