"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { playbackHistoryMs, type PlaybackHistory } from "@/lib/media/playback-history";

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
        <div className="h-28 min-w-0" onKeyDown={event => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) event.stopPropagation();
        }}>
            {hasData ? (
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 300, height: 112 }}>
                    <LineChart data={data} accessibilityLayer aria-label={frames ? "Frame rate over the last 60 seconds" : "Buffer ahead over the last 60 seconds"}
                        margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--stats-chart-grid)" />
                        <XAxis dataKey="time" type="number" domain={[-playbackHistoryMs / 1000, 0]} ticks={[-60, -30, 0]}
                            tickFormatter={xLabel} tick={{ fill: "#ccc", fontSize: 10 }} axisLine={false} tickLine={false}
                            allowDataOverflow height={18} />
                        <YAxis width={34} domain={[0, "auto"]} tickCount={3} tickFormatter={value => `${value}${unit}`}
                            tick={{ fill: "#ccc", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip labelFormatter={label => typeof label === "number" ? xLabel(label) : label} isAnimationActive={false}
                            formatter={(value, name) => [`${Number(value).toFixed(1)} ${name === "Presented" ? "fps" : unit}`, name]}
                            contentStyle={{ background: "#151515", border: "1px solid #444", borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: "white" }} />
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
            ) : <p className="grid h-full place-items-center text-xs text-white/60">Waiting for {frames ? "frame" : "buffer"} samples.</p>}
        </div>
    );
}
