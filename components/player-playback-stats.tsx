"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { GripHorizontal, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { playbackFrameRate, readWebPlaybackStats } from "@/lib/media/playback-stats";
import styles from "./player-playback-stats.module.css";

const seconds = (ms?: number | null) => ms == null ? undefined : `${(ms / 1000).toFixed(1)} s`;
const gutter = 12;
type Position = { x: number; y: number };

function fitPosition(panel: HTMLElement, bounds: Element, position: Position): Position {
    const x = Math.max(gutter, Math.min(position.x, bounds.clientWidth - panel.offsetWidth - gutter));
    const y = Math.max(gutter, Math.min(position.y, bounds.clientHeight - panel.offsetHeight - gutter));
    return x === position.x && y === position.y ? position : { x, y };
}

export function PlayerPlaybackStats({ open, videoRef, onClose }: {
    open: boolean;
    videoRef: RefObject<HTMLVideoElement | null>;
    onClose: () => void;
}) {
    const moveInstructionsId = useId();
    const panelRef = useRef<HTMLElement>(null);
    const drag = useRef<{ id: number; handle: HTMLElement; start: Position; origin: Position } | null>(null);
    const [position, setPosition] = useState<Position | null>(null);
    const [frozen, setFrozen] = useState(false);
    const [reading, setReading] = useState<{ stats: ReturnType<typeof readWebPlaybackStats>; fps?: number }>();

    const releaseDrag = useCallback(() => {
        const active = drag.current;
        drag.current = null;
        if (active?.handle.hasPointerCapture(active.id)) active.handle.releasePointerCapture(active.id);
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        const panel = panelRef.current;
        const bounds = panel?.offsetParent;
        if (!panel || !bounds) return;
        const resize = new ResizeObserver(() => {
            setPosition(current => current && fitPosition(panel, bounds, current));
        });
        resize.observe(panel);
        resize.observe(bounds);
        return () => {
            resize.disconnect();
            releaseDrag();
        };
    }, [open, releaseDrag]);

    const moveTo = (target: Position) => {
        const panel = panelRef.current;
        if (panel?.offsetParent) setPosition(fitPosition(panel, panel.offsetParent, target));
    };
    const movePointer = (event: PointerEvent<HTMLElement>) => {
        const active = drag.current;
        if (active?.id !== event.pointerId) return;
        moveTo({ x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y });
    };
    const endDrag = (event: PointerEvent<HTMLElement>) => {
        if (drag.current?.id === event.pointerId) releaseDrag();
    };

    useEffect(() => {
        if (!open || frozen) return;
        let previous: { video: HTMLVideoElement; stats: ReturnType<typeof readWebPlaybackStats>; at: number } | undefined;
        const sample = () => {
            const video = videoRef.current;
            if (document.hidden || !video) {
                previous = undefined;
                return;
            }
            const stats = readWebPlaybackStats(video);
            const at = performance.now();
            const fps = previous?.video === video ? playbackFrameRate(previous.stats, stats, at - previous.at) : undefined;
            previous = { video, stats, at };
            setReading({ stats, fps });
        };
        const reset = () => { previous = undefined; };
        const timer = window.setInterval(sample, 1000);
        document.addEventListener("visibilitychange", reset);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", reset);
        };
    }, [open, frozen, videoRef]);

    const stats = reading?.stats;
    const freezeLabel = frozen ? "Resume stats updates" : "Freeze stats";
    const FreezeIcon = frozen ? Play : Pause;
    const rows = [
        ["Playback", stats?.path],
        ["Decoder route", stats?.route],
        ["Resolution", stats?.resolution],
        ["Presented rate", reading?.fps === undefined ? undefined : `${reading.fps.toFixed(1)} fps`],
        ["Frames presented", stats?.presented],
        ["Frames dropped", stats?.dropped],
        ["Frames late", stats?.late],
        ["WebGPU draws submitted", stats?.draws],
        ["HDR output", stats?.hdr],
        ["Video buffer ahead", seconds(stats?.videoAheadMs)],
        ["Audio buffer ahead", seconds(stats?.audioAheadMs)],
        ["Audio underruns", stats?.audioUnderflows],
        ["Fallback reason", stats?.fallback],
    ] as const;
    return <section ref={panelRef} inert={!open} aria-label="Stats for nerds" data-player-stats="" data-open={open ? "" : undefined}
        style={position ? { left: position.x, top: position.y } : undefined}
        className={`${styles.panel} absolute top-3 z-[var(--layer-overlay)] pointer-events-auto transform-gpu flex max-h-[55%] w-[22rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-white/8 bg-black/85 text-[0.8125rem] leading-normal text-white shadow-lg shadow-black/35 ${position ? "" : "end-3"}`}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 pb-1 pt-1.5">
            <span id={moveInstructionsId} className="sr-only">Use arrow keys to move the stats panel.</span>
            <h2 tabIndex={0} aria-describedby={moveInstructionsId}
                className="flex min-h-7 flex-1 cursor-grab touch-none select-none items-center gap-1.5 rounded-sm text-sm font-semibold leading-tight active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-ring"
                onPointerDown={event => {
                    const panel = panelRef.current;
                    if (!panel || !event.isPrimary || event.button !== 0) return;
                    releaseDrag();
                    const handle = event.currentTarget;
                    handle.setPointerCapture(event.pointerId);
                    drag.current = { id: event.pointerId, handle, start: { x: event.clientX, y: event.clientY }, origin: { x: panel.offsetLeft, y: panel.offsetTop } };
                    event.preventDefault();
                }}
                onPointerMove={movePointer}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onKeyDown={event => {
                    const panel = panelRef.current;
                    if (!panel || event.altKey || event.metaKey || event.ctrlKey) return;
                    const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                    const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                    if (!dx && !dy) return;
                    event.preventDefault();
                    event.stopPropagation();
                    moveTo({ x: panel.offsetLeft + dx * 16, y: panel.offsetTop + dy * 16 });
                }}>
                <GripHorizontal aria-hidden="true" className="size-4 shrink-0 text-white/55" />
                Stats for nerds
            </h2>
            <div className="-me-1 ms-auto flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon-xs" aria-label={freezeLabel} title={freezeLabel}
                    className="size-7 text-white hover:bg-white/15" onClick={() => setFrozen(value => !value)}>
                    <FreezeIcon aria-hidden="true" className="size-4 scale-80" fill="currentColor" />
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Hide stats for nerds"
                    className="size-7 text-white hover:bg-white/15" onClick={() => {
                        const player = panelRef.current?.parentElement;
                        releaseDrag();
                        onClose();
                        player?.focus({ preventScroll: true });
                    }}>
                    <X aria-hidden="true" className="size-4" />
                </Button>
            </div>
        </div>
        <div className="min-h-0 select-text overflow-y-auto overscroll-contain touch-pan-y px-3 pb-3">
            {stats ? <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
                {rows.map(([label, value]) => value === undefined ? null : <div key={label} className="col-span-2 grid grid-cols-subgrid">
                    <dt className="min-w-0 wrap-break-word text-white/75">{label}</dt>
                    <dd className="min-w-0 wrap-break-word text-end font-medium tabular-nums"><bdi>{value}</bdi></dd>
                </div>)}
            </dl> : <p className="text-white/75">Waiting for playback data.</p>}
        </div>
    </section>;
}
