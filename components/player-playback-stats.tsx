"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import dynamic from "next/dynamic";
import { Check, Copy, GripHorizontal, Pause, Play, X } from "lucide-react";
import { Accordion } from "@/components/arc/accordion/accordion";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Button } from "@/components/ui/button";
import { observePlaybackHistory, playbackDiagnostics, type PlaybackHistory } from "@/lib/media/playback-history";
import { readNativePlaybackStats, readWebPlaybackStats } from "@/lib/media/playback-stats";
import styles from "./player-playback-stats.module.css";

const Timeline = dynamic(() => import("./player-playback-timeline"), { loading: () => <div className={styles.plot} /> });
const graphOptions = [{ value: "buffer", label: "Buffer" }, { value: "frames", label: "Frames" }];
const seconds = (ms?: number | null) => ms == null ? undefined : `${(ms / 1000).toFixed(1)} s`;
const gutter = 12;
type Position = { x: number; y: number };

function fitPosition(panel: HTMLElement, bounds: Element, position: Position): Position {
    const x = Math.max(gutter, Math.min(position.x, bounds.clientWidth - panel.offsetWidth - gutter));
    const y = Math.max(gutter, Math.min(position.y, bounds.clientHeight - panel.offsetHeight - gutter));
    return x === position.x && y === position.y ? position : { x, y };
}

export function PlayerPlaybackStats({ open, obscured = false, videoRef, onClose, native = false }: {
    open: boolean;
    obscured?: boolean;
    videoRef: RefObject<HTMLVideoElement | null>;
    onClose: () => void;
    native?: boolean;
}) {
    const moveInstructionsId = useId();
    const panelRef = useRef<HTMLElement>(null);
    const drag = useRef<{ id: number; handle: HTMLElement; start: Position; origin: Position } | null>(null);
    const [position, setPosition] = useState<Position | null>(null);
    const [frozen, setFrozen] = useState(false);
    const [history, setHistory] = useState<PlaybackHistory>();
    const lastHistory = useRef<PlaybackHistory>(undefined);
    const [mode, setMode] = useState<"buffer" | "frames">("buffer");
    const [copyStatus, setCopyStatus] = useState<"copied" | "failed">();

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
        const video = videoRef.current;
        if (!open || frozen || !video) return;
        return observePlaybackHistory(video, native ? readNativePlaybackStats : readWebPlaybackStats, reading => {
            lastHistory.current = reading;
            setHistory(reading);
        }, lastHistory.current);
    }, [open, frozen, native, videoRef]);

    useEffect(() => {
        if (copyStatus !== "copied") return;
        const timer = window.setTimeout(() => setCopyStatus(undefined), 2200);
        return () => window.clearTimeout(timer);
    }, [copyStatus]);

    const copyDiagnostics = async () => {
        if (!history) return;
        try {
            await navigator.clipboard.writeText(playbackDiagnostics(history));
            setCopyStatus("copied");
        } catch {
            setCopyStatus("failed");
        }
    };

    const stats = history?.stats;
    const fps = history?.samples.at(-1)?.fps;
    const hasFrameStats = stats?.presented !== undefined || stats?.dropped !== undefined || stats?.observedFps !== undefined;
    const chartMode = hasFrameStats ? mode : "buffer";
    const freezeLabel = frozen ? "Resume stats updates" : "Freeze stats";
    const FreezeIcon = frozen ? Play : Pause;
    const summary = [
        ["Playback", stats?.path],
        ["Resolution", stats?.resolution],
        ["Buffer ahead", seconds(stats?.videoAheadMs)],
        ["Presented rate", fps === undefined ? undefined : `${fps.toFixed(1)} fps`],
        ["Frames dropped", stats?.dropped],
        ["HDR output", stats?.hdr],
    ] as const;
    const details = ([
        ["Source color format", stats?.sourceHdr],
        ["Engine version", stats?.engineVersion],
        ["Decoder route", stats?.route],
        ["Video decoder", stats?.videoDecoder],
        ["Audio decoder", stats?.audioDecoder],
        ["Video codec", stats?.videoCodec],
        ["Audio codec", stats?.audioCodec],
        ["Frames presented", stats?.presented],
        ["Decoder frame drops", stats?.decoderDropped],
        ["Frames late", stats?.late],
        ["WebGPU draws submitted", stats?.draws],
        ["Audio buffer ahead", seconds(stats?.audioAheadMs)],
        ["Audio underruns", stats?.audioUnderflows],
        ["Fallback reason", stats?.fallback],
    ] as const).filter(([, value]) => value !== undefined);
    const visible = open && !obscured;
    return <section ref={panelRef} inert={!visible} aria-label="Stats for nerds" data-player-stats="" data-open={visible ? "" : undefined}
        style={position ? { left: position.x, top: position.y } : undefined}
        className={`${floatingSurface.surface} ${styles.panel} absolute top-3 z-[var(--layer-player-stats)] pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-border text-[0.8125rem] leading-normal text-popover-foreground ${position ? "" : "end-3"}`}>
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
            <span id={moveInstructionsId} className="sr-only">Use the arrow keys to move the stats panel</span>
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
                <GripHorizontal aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                Stats for nerds
            </h2>
            <div className="-me-1 ms-auto flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy diagnostics"
                    title={copyStatus === "copied" ? "Diagnostics copied" : "Copy diagnostics"} disabled={!history}
                    className="size-7" onClick={copyDiagnostics}>
                    {copyStatus === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label={freezeLabel} title={freezeLabel}
                    className="size-7" onClick={() => setFrozen(value => !value)}>
                    <FreezeIcon aria-hidden="true" className="size-4 scale-80" fill="currentColor" strokeWidth={1.5} />
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Hide stats for nerds"
                    className="size-7" onClick={() => {
                        const player = panelRef.current?.parentElement;
                        releaseDrag();
                        onClose();
                        player?.focus({ preventScroll: true });
                    }}>
                    <X aria-hidden="true" className="size-4" />
                </Button>
            </div>
        </div>
        <div data-selectable-text="" className={`${styles.body} min-h-0 select-text overflow-y-auto overscroll-contain touch-pan-y`}>
            <p role="status" className={copyStatus === "failed" ? "pb-2 text-xs text-destructive" : "sr-only"}>
                {copyStatus === "copied" ? "Diagnostics copied." : copyStatus === "failed" ? "Couldn’t copy diagnostics." : ""}
            </p>
            {history && <div className={styles.timeline}>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Last 60 seconds</span>
                    {hasFrameStats && <SegmentedControl className={styles.graphSwitch} label="Playback graph"
                        options={graphOptions} value={chartMode} onValueChange={value => setMode(value === "frames" ? "frames" : "buffer")} />}
                </div>
                {/* Keep the current plot through the panel's exit transition after it has loaded. */}
                <Timeline history={history} mode={chartMode} />
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                        {chartMode === "buffer" && <span className={styles.lineKey}>Buffer ahead</span>}
                        {chartMode === "frames" && stats?.presented !== undefined && <span className={styles.lineKey}>Presented</span>}
                        {chartMode === "frames" && stats?.dropped !== undefined && <span className={styles.dropKey}>Dropped</span>}
                        {history.events.some(event => event.kind === "seek") && <span className={styles.seekKey}>Seek</span>}
                    </div>
                    <span className={history.stallCount ? styles.stallKey : undefined}>{history.stallCount} {history.stallCount === 1 ? "stall" : "stalls"}
                        {history.stallCount > 0 && ` · ${seconds(history.stallMs)}`}</span>
                </div>
            </div>}
            {stats ? <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-1">
                    {summary.map(([label, value]) => value === undefined ? null : <div key={label} className="min-w-0 wrap-break-word">
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="text-sm font-medium tabular-nums"><bdi>{value}</bdi></dd>
                    </div>)}
                </dl>
                {details.length > 0 && <div className={styles.details}>
                    <Accordion size="sm" defaultOpen={-1} triggerClassName={styles.detailsTrigger} items={[{
                        title: "Playback details",
                        content: <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-1 pb-2 text-[0.8125rem] leading-normal text-popover-foreground">
                            {details.map(([label, value]) => <div key={label} className="col-span-2 grid grid-cols-subgrid">
                                <dt className="min-w-0 wrap-break-word text-muted-foreground">{label}</dt>
                                <dd className="min-w-0 wrap-break-word text-end tabular-nums"><bdi>{value}</bdi></dd>
                            </div>)}
                        </dl>,
                    }]} />
                </div>}
            </> : <p className="text-muted-foreground">Waiting for playback data…</p>}
        </div>
    </section>;
}
