"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import { playbackHistoryMs, type PlaybackHistory } from "@/lib/media/playback-history";
import styles from "./player-playback-stats.module.css";

const colors = {
    primary: "var(--stats-chart-line)",
    drops: "var(--stats-chart-drop)",
    stall: "var(--stats-chart-stall)",
    seek: "var(--stats-chart-seek)",
};

export default function PlayerPlaybackTimeline({ history, mode }: { history: PlaybackHistory; mode: "buffer" | "frames" }) {
    const frames = mode === "frames";
    const relativeSeconds = (at: number) => (at - history.at) / 1000;
    const data = history.samples.map(sample => ({ ...sample, time: relativeSeconds(sample.at) }));
    const hasData = data.some(sample => frames ? sample.fps !== undefined || sample.dropsPerSecond !== undefined : sample.buffer !== undefined);
    const xLabel = (value: number) => {
        const seconds = Math.abs(Math.round(value));
        return seconds === 0 ? "Latest" : `${seconds}s ago`;
    };
    const unit = frames ? "/s" : "s";

    return (
        <div className={styles.plot} onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) event.stopPropagation();
        }}>
            {hasData ? (
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 140 }}>
                    <LineChart data={data} accessibilityLayer aria-label={frames ? "Frame rate over the last 60 seconds" : "Buffer ahead over the last 60 seconds"}
                        margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--stats-chart-grid)" />
                        <XAxis dataKey="time" type="number" domain={[-playbackHistoryMs / 1000, 0]} ticks={[-60, -30, 0]}
                            tickFormatter={xLabel} tick={{ className: styles.axisTick }} tickMargin={8}
                            axisLine={false} tickLine={false} allowDataOverflow height={26} />
                        <YAxis width={38} domain={[0, "auto"]} tickCount={3} tickFormatter={value => `${value}${unit}`}
                            tick={{ className: styles.axisTick }} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ stroke: "var(--stats-chart-grid)" }}
                            position={{ y: 4 }} offset={8} isAnimationActive={false}
                            content={({ active, payload, label }) => active && payload.length > 0 ? (
                                <div className={`${floatingSurface.surface} ${styles.tooltip}`} role="status">
                                    {typeof label === "number" && <div className="mb-1 text-muted-foreground">{xLabel(label)}</div>}
                                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                                        {payload.map(item => (
                                            <div key={String(item.dataKey)} className="col-span-2 grid grid-cols-subgrid items-center">
                                                <dt className="flex items-center gap-1.5">
                                                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                                                    {item.name}
                                                </dt>
                                                <dd className="text-end font-medium tabular-nums">
                                                    {Number(item.value).toFixed(1)} {item.name === "Presented" ? "fps" : unit}
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            ) : null} />
                        {history.events.map(event => (
                            <ReferenceLine key={`${event.kind}:${event.at}`} x={relativeSeconds(event.at)}
                                stroke={event.kind === "stall" ? colors.stall : colors.seek}
                                strokeDasharray={event.kind === "seek" ? "3 3" : undefined} />
                        ))}
                        <Line dataKey={frames ? "fps" : "buffer"} name={frames ? "Presented" : "Buffer ahead"}
                            type="linear" stroke={colors.primary} strokeWidth={2} dot={data.length === 1 && { r: 2 }}
                            isAnimationActive={false} />
                        {frames && <Line dataKey="dropsPerSecond" name="Dropped" type="linear"
                            stroke={colors.drops} strokeWidth={2} dot={false} isAnimationActive={false} />}
                    </LineChart>
                </ResponsiveContainer>
            ) : <p className="grid h-full place-items-center text-xs text-muted-foreground">Waiting for {frames ? "frame" : "buffer"} samples.</p>}
        </div>
    );
}
