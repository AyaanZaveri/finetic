import { readMatroskaSubtitleTracks, matroskaSubtitleText, type MatroskaSubtitleTrack } from "./matroska-subtitles";
import type { WebGpuSubtitleBlock } from "./webgpu-module";

type Caption = { start: number; end: number; text: string };
export interface WebGpuTextTrack {
    id: string; kind: "subtitles"; language: string; label: string;
    forced: boolean; hearingImpaired: boolean; mode: "disabled" | "hidden" | "showing";
}
export type WebGpuTextTrackList = EventTarget & { length: number; [index: number]: WebGpuTextTrack };

/** The engine already reads subtitle blocks with the video. Read track headers
 * once, then consume those blocks without a second cluster/video downloader. */
export function createWebGpuSubtitles(url: string, notify: (_event: string) => void) {
    const tracks = new EventTarget() as WebGpuTextTrackList;
    tracks.length = 0;
    const abort = new AbortController();
    const metadata = new Map<number, MatroskaSubtitleTrack>();
    const captions = new Map<number, Map<string, Caption>>();
    const indexes = new Map<number, { cues: Caption[]; ends: number[] }>();
    let early: WebGpuSubtitleBlock[] = [], earlyBytes = 0;
    let closed = false, listed = false, started = false, queuedBytes = 0, captionBytes = 0;
    let work = Promise.resolve();
    let snapshotKey = "", snapshotText: string | null = null;
    const changed = () => { snapshotKey = ""; notify("subtitlechange"); };
    const supply = (blocks: readonly WebGpuSubtitleBlock[]) => {
        if (closed) return;
        if (!listed) {
            for (const block of blocks) {
                if (early.length >= 5000 || earlyBytes + block.data.byteLength > 2 * 1024 * 1024) break;
                early.push(block); earlyBytes += block.data.byteLength;
            }
            return;
        }
        const accepted: { block: WebGpuSubtitleBlock; track: MatroskaSubtitleTrack }[] = [];
        let batchBytes = 0;
        for (const block of blocks) {
            const track = metadata.get(block.trackNumber);
            if (!track || !Number.isFinite(block.timestampMs) || block.timestampMs < 0 || block.data.byteLength > 64 * 1024
                || queuedBytes + batchBytes + block.data.byteLength > 2 * 1024 * 1024) continue;
            accepted.push({ block, track }); batchBytes += block.data.byteLength;
        }
        if (!accepted.length) return;
        queuedBytes += batchBytes;
        work = work.then(async () => {
            let updated = false;
            for (const { block, track } of accepted) {
                if (closed) return;
                let text: string;
                try { text = await matroskaSubtitleText(track, block); } catch { continue; }
                if (closed) return;
                if (!text) continue;
                const start = block.timestampMs / 1000;
                const duration = block.durationMs === null ? 5000 : block.durationMs;
                if (!Number.isFinite(duration) || duration <= 0) continue;
                const key = `${start}:${text}`;
                const cues = captions.get(track.number)!;
                if (cues.has(key)) continue;
                cues.set(key, { start, end: start + Math.min(duration, 600_000) / 1000, text }); captionBytes += text.length * 2;
                while (cues.size > 20_000 || captionBytes > 8 * 1024 * 1024) {
                    const oldest = cues.keys().next().value;
                    if (oldest === undefined) break;
                    captionBytes -= cues.get(oldest)!.text.length * 2; cues.delete(oldest);
                }
                indexes.delete(track.number); updated = true;
            }
            if (updated) changed();
        }).catch(() => { /* An invalid packet cannot stop video or other captions. */ })
            .finally(() => { queuedBytes -= batchBytes; });
    };
    return {
        tracks,
        start(playbackUrl = url) {
            if (started || closed) return;
            started = true;
            void readMatroskaSubtitleTracks(playbackUrl, AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]))
                .then(found => {
                    if (closed) return;
                    for (const track of found.slice(0, 128)) {
                        if (metadata.has(track.number)) continue;
                        metadata.set(track.number, track); captions.set(track.number, new Map());
                        let mode: "disabled" | "hidden" | "showing" = "disabled";
                        tracks[tracks.length++] = { id: `mkv:${track.number}`, kind: "subtitles", language: track.language, label: track.label,
                            forced: track.forced, hearingImpaired: track.hearingImpaired,
                            get mode() { return mode; }, set mode(value: "disabled" | "hidden" | "showing") {
                                if (closed || !["disabled", "hidden", "showing"].includes(value) || mode === value) return;
                                mode = value; tracks.dispatchEvent(new Event("change")); changed();
                            } };
                        tracks.dispatchEvent(new Event("addtrack"));
                    }
                    listed = true;
                    const waiting = early; early = []; earlyBytes = 0;
                    supply(waiting); notify("trackschange");
                }).catch(() => { listed = true; early = []; earlyBytes = 0; });
        },
        supply,
        text(time: number): string | null {
            const active = Array.from(tracks).filter(track => track.mode === "showing");
            const visible: Caption[] = [];
            for (const track of active) {
                const number = Number(track.id.slice(4));
                let index = indexes.get(number);
                if (!index) {
                    const cues = [...(captions.get(number)?.values() ?? [])].sort((a, b) => a.start - b.start);
                    let end = 0;
                    const ends = cues.map(cue => (end = Math.max(end, cue.end)));
                    index = { cues, ends }; indexes.set(number, index);
                }
                let lo = 0, hi = index.cues.length;
                while (lo < hi) { const mid = (lo + hi) >>> 1; if (index.cues[mid].start <= time) lo = mid + 1; else hi = mid; }
                for (let i = lo - 1; i >= 0 && index.ends[i] > time; i--) if (time < index.cues[i].end) visible.push(index.cues[i]);
            }
            visible.sort((a, b) => a.start - b.start);
            const key = visible.map(cue => `${cue.start}:${cue.text}`).join("\0");
            if (key !== snapshotKey) { snapshotKey = key; snapshotText = visible.length ? [...new Set(visible.map(cue => cue.text))].join("\n") : null; }
            // An empty key must clear an earlier caption after a mode change.
            if (!visible.length) snapshotText = null;
            return snapshotText;
        },
        dispose() {
            closed = true; abort.abort(); early = []; metadata.clear(); captions.clear(); indexes.clear();
            for (let i = 0; i < tracks.length; i++) Reflect.deleteProperty(tracks, i);
            tracks.length = 0; snapshotText = null;
        },
    };
}
