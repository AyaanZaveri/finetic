import { playbackFrameRate, type PlaybackStats } from "./playback-stats";

export const playbackHistoryMs = 60_000;
const maxSampleGapMs = 2500;

export type PlaybackSample = {
    at: number;
    buffer?: number;
    fps?: number;
    dropsPerSecond?: number;
};

export type PlaybackHistory = {
    at: number;
    stats: PlaybackStats;
    samples: PlaybackSample[];
    events: { at: number; kind: "stall" | "seek" }[];
    stallCount: number;
    stallMs: number;
};

export function observePlaybackHistory(video: HTMLVideoElement, readStats: (_video: HTMLVideoElement) => PlaybackStats,
    onReading: (_history: PlaybackHistory) => void, initial?: PlaybackHistory) {
    let samples = initial?.samples ?? [];
    let events = initial?.events ?? [];
    let stallCount = initial?.stallCount ?? 0;
    let stallMs = initial?.stallMs ?? 0;
    let stallStarted: number | undefined;
    let previous: { at: number; stats: PlaybackStats } | undefined;
    let stats = initial?.stats;
    let hasPlayed = !video.paused && video.readyState >= 3;

    const publish = (at: number) => {
        if (!stats) return;
        const cutoff = at - playbackHistoryMs;
        samples = samples.filter(sample => sample.at >= cutoff);
        events = events.filter(event => event.at >= cutoff);
        onReading({ at, stats, samples, events, stallCount, stallMs: stallMs + (stallStarted === undefined ? 0 : at - stallStarted) });
    };
    const sample = () => {
        if (document.hidden) return;
        const at = performance.now();
        stats = readStats(video);
        const elapsed = previous ? at - previous.at : Infinity;
        const baseline = elapsed <= maxSampleGapMs ? previous?.stats : undefined;
        const reading: PlaybackSample = {
            at,
            buffer: stats.videoAheadMs == null ? undefined : stats.videoAheadMs / 1000,
            fps: baseline && playbackFrameRate(baseline, stats, elapsed),
            dropsPerSecond: baseline && playbackFrameRate(baseline, stats, elapsed, "dropped"),
        };
        const last = samples.at(-1);
        if (last && at - last.at > maxSampleGapMs) samples = [...samples, { at: (last.at + at) / 2 }];
        samples = [...samples, reading];
        previous = { at, stats };
        publish(at);
    };
    const endStall = (at: number) => {
        if (stallStarted !== undefined) stallMs += at - stallStarted;
        stallStarted = undefined;
    };
    const interrupt = () => {
        previous = undefined;
        endStall(performance.now());
    };
    const listeners = {
        playing: () => {
            hasPlayed = true;
            endStall(performance.now());
        },
        waiting: () => {
            if (document.hidden || !hasPlayed || video.paused || video.seeking || stallStarted !== undefined) return;
            const at = performance.now();
            stallStarted = at;
            stallCount++;
            events = [...events, { at, kind: "stall" }];
            publish(at);
        },
        seeking: () => {
            interrupt();
            if (document.hidden || !hasPlayed) return;
            const at = performance.now();
            const last = events.at(-1);
            if (last?.kind === "seek" && at - last.at < 500) return;
            events = [...events, { at, kind: "seek" }];
            publish(at);
        },
        seeked: interrupt,
        pause: interrupt,
        ended: interrupt,
        error: interrupt,
        emptied: () => {
            interrupt();
            hasPlayed = false;
        },
    };
    const visibilityChanged = () => {
        interrupt();
        if (!document.hidden) sample();
    };
    for (const [event, listener] of Object.entries(listeners)) video.addEventListener(event, listener);
    document.addEventListener("visibilitychange", visibilityChanged);
    sample();
    const timer = window.setInterval(sample, 1000);
    return () => {
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", visibilityChanged);
        for (const [event, listener] of Object.entries(listeners)) video.removeEventListener(event, listener);
    };
}

export function playbackDiagnostics({ at, stats, samples, events, stallCount, stallMs }: PlaybackHistory) {
    // Only export known diagnostics fields. Fallback details can contain arbitrary error text.
    const { path, resolution, hdr, videoCodec, audioCodec, presented, dropped, decoderDropped, late, draws,
        videoAheadMs, audioAheadMs, audioUnderflows } = stats;
    const elapsed = (time: number) => Math.round(time - at);
    return JSON.stringify({
        path, resolution, hdr, videoCodec, audioCodec, presented, dropped, decoderDropped, late, draws,
        videoAheadMs, audioAheadMs, audioUnderflows, stallCount, stallMs: Math.round(stallMs),
        samples: samples.map(({ at: time, ...values }) => ({ relativeMs: elapsed(time), ...values })),
        events: events.map(({ at: time, kind }) => ({ relativeMs: elapsed(time), kind })),
    }, null, 2);
}
