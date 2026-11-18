"use client";

import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { playbackFrameRate, readWebPlaybackStats } from "@/lib/media/playback-stats";

const seconds = (ms?: number | null) => ms == null ? undefined : `${(ms / 1000).toFixed(1)} s`;

export function PlayerPlaybackStats({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
    const [frozen, setFrozen] = useState(false);
    const [reading, setReading] = useState<{ stats: ReturnType<typeof readWebPlaybackStats>; fps?: number }>();

    useEffect(() => {
        if (frozen) return;
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
    }, [frozen, videoRef]);

    const stats = reading?.stats;
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
    return <section aria-label="Stats for nerds"
        className="absolute end-3 top-3 z-30 max-h-[55%] w-80 max-w-[calc(100%-1.5rem)] overflow-auto rounded-lg border border-white/20 bg-black/60 p-3 text-xs text-white">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Stats for nerds</h2>
            <Button type="button" variant="ghost" size="sm" className="min-h-8 text-xs" onClick={() => setFrozen(value => !value)}>
                {frozen ? "Resume updates" : "Freeze stats"}
            </Button>
        </div>
        {stats ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            {rows.map(([label, value]) => value === undefined ? null : <div key={label} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-white/90">{label}</dt>
                <dd className="min-w-0 break-words text-end tabular-nums">{value}</dd>
            </div>)}
        </dl> : <p>Waiting for playback data.</p>}
    </section>;
}
