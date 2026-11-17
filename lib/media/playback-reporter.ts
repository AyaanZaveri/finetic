import type { PlaybackReportInput, PlaybackReportResult } from "@/app/actions/media";

export const PROGRESS_REPORT_INTERVAL_MS = 30_000;
type Kind = "start" | "progress" | "stopped";
type Update = { kind: Kind; input: PlaybackReportInput; attempts: number };

/** One writer for the mounted player. Sample locally, sync at most every 30s,
 * and flush pause/stop. Keep starts/stops ordered across episode changes. */
export function createPlaybackReporter(
    write: (_kind: Kind, _input: PlaybackReportInput) => Promise<PlaybackReportResult>,
    now = Date.now,
) {
    let sessionId = "", watched = 0, previous: { time: number; at: number } | undefined;
    let lastReportAt = 0, acknowledged = "", running = false;
    let generation = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const queue: Update[] = [];
    const signature = (input: PlaybackReportInput) => JSON.stringify([
        input.sessionId, input.currentTimeSeconds, input.durationSeconds, input.watchedTimeSeconds,
    ]);
    async function drain() {
        if (running || retry) return;
        running = true;
        try {
            while (queue.length) {
                const update = queue.shift()!;
                const activeGeneration = generation;
                if (update.kind === "progress" && signature(update.input) === acknowledged) continue;
                let result: PlaybackReportResult = false;
                try { result = await write(update.kind, update.input); } catch { /* Retry with backoff. */ }
                if (generation !== activeGeneration) continue;
                if (result === true) { acknowledged = signature(update.input); continue; }
                // A newer progress snapshot contains the same cumulative watch
                // time. Prefer it to replaying an obsolete resume position.
                if (queue[0]?.kind === "progress" && queue[0].input.sessionId === update.input.sessionId
                    && update.kind === "progress") queue[0].attempts = update.attempts;
                else queue.unshift(update);
                update.attempts++;
                if (update.attempts > 3) { queue.shift(); continue; }
                queue[0].attempts = update.attempts;
                const backoff = Math.min(300_000, PROGRESS_REPORT_INTERVAL_MS * 2 ** (update.attempts - 1));
                const retryAfter = typeof result === "object" ? result.retryAfterMs : 0;
                retry = setTimeout(() => { retry = undefined; void drain(); }, Math.max(backoff, retryAfter));
                return;
            }
        } finally { running = false; }
    }
    return {
        cancel() {
            generation++; queue.length = 0; sessionId = "";
            clearTimeout(retry); retry = undefined;
        },
        begin() {
            sessionId = crypto.randomUUID(); watched = 0; previous = undefined;
            lastReportAt = now(); acknowledged = "";
        },
        observe(time: number, paused: boolean, seeking: boolean, rate = 1) {
            const at = now();
            if (previous && !paused && !seeking) {
                const delta = time - previous.time;
                const elapsed = Math.max(0, (at - previous.at) / 1000) * rate;
                // Like Stremio core, do not treat large position jumps as time
                // watched. The wall clock also bounds sparse/background events.
                if (delta > 0 && delta <= Math.min(2, elapsed + 0.25)) watched += Math.min(delta, elapsed);
            }
            previous = { time, at };
        },
        report(kind: Kind, payload: PlaybackReportInput, periodic = false) {
            if (!sessionId) return;
            if (periodic && now() - lastReportAt < PROGRESS_REPORT_INTERVAL_MS) return;
            const input = { ...payload, sessionId, watchedTimeSeconds: watched };
            if (kind === "progress" && signature(input) === acknowledged) return;
            lastReportAt = now();
            const tail = queue.at(-1);
            if (kind === "progress" && tail?.kind === kind && tail.input.sessionId === sessionId) tail.input = input;
            else queue.push({ kind, input, attempts: 0 });
            void drain();
        },
    };
}
