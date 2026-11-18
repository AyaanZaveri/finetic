import { loadWebGpuModule, type WebGpuAudioTrack, type WebGpuPlayer, type WebGpuStats } from "./webgpu-module";
import { resolveWebGpuSource } from "./webgpu-source";
import { createWebGpuSubtitles } from "./webgpu-subtitles";
import { preferredAudioTrack } from "./audio-language";
import { readPlaybackPreferences } from "./playback-preferences";

export type WebGpuVideo = HTMLVideoElement & { webgpu?: {
    readonly silent: boolean; stats(): WebGpuStats | null; picture(): HTMLCanvasElement | null; subtitle(_time: number): string | null;
} };

/** Keep one real video element registered with the controls. Its media API drives
 * the embedded engine until a same-file fallback restores the browser API. */
export function attachWebGpuVideo(video: WebGpuVideo, url: string, fallback: (_source: string) => void, startPosition = 0): () => void {
    let player: WebGpuPlayer | undefined;
    let lastStats: WebGpuStats | null = null;
    let nextStatsSample = 0;
    let closed = false, opened = false, metadataSent = false, silent = false;
    let generation = 0, initialMetadata = false;
    let hdrAttempt = false, hdrRejected = false;
    const preferences = readPlaybackPreferences();
    const hdrFallback = (reason: "display-unavailable" | "output-failed" | "browser-fallback") => {
        if (!preferences.hdrOutput) return;
        video.dataset.webgpuHdr = reason;
        emit("webgpu-hdr-unavailable");
    };
    let playbackUrl = url, sourceResolved = false;
    const sourceAbort = new AbortController();
    let time = Number.isFinite(startPosition) ? Math.max(0, startPosition) : 0;
    let duration = NaN, width = 0, height = 0, ready = 0;
    let paused = true, ended = false, seeking = false;
    let volume = video.volume, muted = video.muted, rate = video.playbackRate;
    let pendingSeek: number | undefined;
    let seekTarget: number | undefined;
    let tracks: readonly WebGpuAudioTrack[] = [], selected: number | null = null;
    let switching = false;
    let fallbackMetadata: (() => void) | undefined;
    const audioTracks = new EventTarget() as EventTarget & { length: number; [index: number]: unknown };
    audioTracks.length = 0;
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const frames = new Map<number, number>();
    let nextFrame = 0;
    let deliveredMs: number | null = null;
    const sleepingFrames = new Map<number, (_now: number) => void>();
    const emit = (name: string) => {
        if (closed) return;
        video.dispatchEvent(new Event(name));
        if (["play", "playing", "timeupdate", "seeked", "loadeddata"].includes(name)) {
            for (const [id, tick] of sleepingFrames) frames.set(id, requestAnimationFrame(tick));
            sleepingFrames.clear();
        }
    };
    const subtitles = createWebGpuSubtitles(url, emit);
    const define = (name: string, descriptor: PropertyDescriptor) => {
        descriptors.set(name, Object.getOwnPropertyDescriptor(video, name));
        Object.defineProperty(video, name, { configurable: true, ...descriptor });
    };
    const cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(startup); sourceAbort.abort(); subtitles.dispose();
        for (const frame of frames.values()) cancelAnimationFrame(frame);
        frames.clear(); sleepingFrames.clear();
        player?.destroy();
        for (const [name, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(video, name, descriptor);
            else Reflect.deleteProperty(video, name);
        }
        delete video.dataset.webgpu; delete video.dataset.webgpuAudio;
    };
    const fail = (atMs = time * 1000, reason = "unknown") => {
        if (closed) return;
        time = Math.max(0, atMs / 1000);
        const shouldPlay = !paused;
        const resume = time;
        const reasonLabel = reasonCode(reason);
        // The engine may tear down its active route before notifying the host.
        const stats = player?.stats() ?? lastStats;
        console.warn("WebGPU playback switched to the browser player", {
            reason: reasonLabel, positionMs: atMs, seeking, width, height,
            route: stats?.route, hdrOutput: stats?.hdrOutput,
            framesPresented: stats?.framesPresented, framesDropped: stats?.framesDropped, framesLate: stats?.framesLate,
            audioAheadMs: stats?.audioAheadMs, videoAheadMs: stats?.videoAheadMs,
            audioUnderflows: stats?.audioUnderflows, clockMs: stats?.clockMs,
        });
        hdrFallback("browser-fallback");
        cleanup();
        // Preserve a useful, URL-free cause when the browser reports a generic format error.
        video.dataset.webgpuFallback = reasonLabel;
        // Restore preferences before loading the same URL through Mux/native.
        video.volume = volume; video.muted = muted; video.playbackRate = rate;
        fallbackMetadata = () => {
            if (resume > 0) video.currentTime = Number.isFinite(video.duration) ? Math.min(resume, Math.max(0, video.duration - .1)) : resume;
            if (shouldPlay) void video.play().catch(() => {});
            else if (initialMetadata) video.pause();
        };
        video.addEventListener("loadedmetadata", fallbackMetadata, { once: true });
        fallback(playbackUrl);
    };
    let startup: ReturnType<typeof setTimeout>;
    define("webgpu", { value: { get silent() { return silent; }, subtitle: subtitles.text, stats: () => player?.stats() ?? null,
        picture: () => video.parentElement?.querySelector<HTMLCanvasElement>(".webgpuPlayerCanvas-visible") ?? null } });
    video.dataset.webgpu = "";
    const getters: Record<string, () => unknown> = { currentSrc: () => playbackUrl, src: () => url, duration: () => duration,
        videoWidth: () => width, videoHeight: () => height, readyState: () => ready, networkState: () => opened ? 1 : 2,
        paused: () => paused, ended: () => ended, seeking: () => seeking, error: () => null,
        buffered: () => ranges(ready >= 2 ? time : 0), seekable: () => ranges(duration),
        audioTracks: () => audioTracks, textTracks: () => subtitles.tracks, disablePictureInPicture: () => true };
    for (const [key, getter] of Object.entries(getters)) define(key, { get: getter });
    define("currentTime", { get: () => time, set: (value: number) => {
        if (!Number.isFinite(value)) return;
        time = Math.max(0, Number.isFinite(duration) ? Math.min(duration, value) : value);
        ended = false; seeking = true; pendingSeek = time; seekTarget = time;
        emit("seeking");
        if (opened) { player?.seek(time * 1000); pendingSeek = undefined; }
    } });
    define("volume", { get: () => volume, set: (value: number) => {
        if (!Number.isFinite(value) || value < 0 || value > 1) return;
        volume = value; player?.setVolume(value); emit("volumechange");
    } });
    define("muted", { get: () => muted, set: (value: boolean) => { muted = Boolean(value); player?.setMuted(muted); emit("volumechange"); } });
    define("playbackRate", { get: () => rate, set: (value: number) => {
        if (!Number.isFinite(value) || value <= 0) return;
        rate = value; player?.setRate(value); emit("ratechange");
    } });
    define("play", { value: async () => {
        if (closed) return;
        if (navigator.userActivation?.hasBeenActive === false && !muted) {
            throw new DOMException("Click play to start audio.", "NotAllowedError");
        }
        const changed = paused;
        paused = false; ended = false;
        if (changed) emit("play");
        if (opened) player?.play();
    } });
    define("pause", { value: () => {
        if (closed || paused) return;
        paused = true; player?.pause(); emit("pause");
    } });
    // Media Chrome may call load while wiring up an already owned source.
    define("load", { value: () => {} });
    define("requestPictureInPicture", { value: async () => {
        throw new DOMException("Picture in picture is unavailable for this playback engine.", "NotSupportedError");
    } });
    define("getVideoPlaybackQuality", { value: () => {
        const stats = player?.stats();
        return { totalVideoFrames: (stats?.framesPresented ?? 0) + (stats?.framesDropped ?? 0),
            droppedVideoFrames: stats?.framesDropped ?? 0, corruptedVideoFrames: 0, creationTime: performance.now() };
    } });
    define("requestVideoFrameCallback", { value: (callback: Parameters<HTMLVideoElement["requestVideoFrameCallback"]>[0]) => {
        const id = ++nextFrame;
        const previous = deliveredMs;
        const tick = (now: number) => {
            if (closed) return;
            const presented = player?.presentedMs() ?? null;
            if (presented !== null && presented !== previous) {
                deliveredMs = presented;
                frames.delete(id);
                callback(now, { mediaTime: presented / 1000, width, height, presentedFrames: player?.stats()?.framesPresented ?? 0,
                    expectedDisplayTime: now, presentationTime: now, processingDuration: 0 });
            } else if (paused) { frames.delete(id); sleepingFrames.set(id, tick); }
            else frames.set(id, requestAnimationFrame(tick));
        };
        frames.set(id, requestAnimationFrame(tick));
        return id;
    } });
    define("cancelVideoFrameCallback", { value: (id: number) => {
        const frame = frames.get(id);
        if (frame !== undefined) cancelAnimationFrame(frame);
        frames.delete(id); sleepingFrames.delete(id);
    } });
    const listTracks = () => {
        for (let i = 0; i < audioTracks.length; i++) Reflect.deleteProperty(audioTracks, i);
        audioTracks.length = tracks.length;
        tracks.forEach((track, index) => {
            audioTracks[index] = { id: String(track.ordinal), language: track.language || "", label: track.title || track.language || `Audio ${index + 1}`,
                get enabled() { return selected === track.ordinal; },
                set enabled(value: boolean) { if (value && selected !== track.ordinal) void selectAudio(track.ordinal); } };
        });
        audioTracks.dispatchEvent(new Event("addtrack"));
        emit("trackschange");
    };
    const selectAudio = async (ordinal: number) => {
        if (closed || !opened || !player || switching) return;
        switching = true;
        const current = generation;
        try {
            const result = await player.setAudio(ordinal);
            if (closed || current !== generation) return;
            if (!result.eligible) { recover(result.reason); return; }
            selected = ordinal;
            audioTracks.dispatchEvent(new Event("change"));
            emit("trackschange");
        } catch { recover("audio-track-switch-failed"); } finally { switching = false; }
    };
    const recover = (reason: string, atMs = time * 1000) => {
        if (closed) return;
        const resumeMs = !metadataSent || seeking ? time * 1000 : atMs;
        video.dataset.webgpuReason = reasonCode(reason);
        const retrySdr = hdrAttempt && !hdrRejected;
        if (retrySdr || (!silent && player && /audio|decode-failed|start-fallback|startup-timeout|route-start-failed/i.test(reason))) {
            if (retrySdr) { hdrRejected = true; hdrAttempt = false; hdrFallback("output-failed"); }
            else silent = true;
            opened = false; metadataSent = false; ready = 0;
            time = Math.max(0, resumeMs / 1000);
            generation++; // Invalidate the failed route before synchronous teardown callbacks.
            player?.destroy();
            emit("waiting");
            void start().catch(() => recover("engine-initialization-failed"));
        } else fail(resumeMs, reason);
    };
    const start = async () => {
        const current = ++generation;
        lastStats = null;
        nextStatsSample = 0;
        clearTimeout(startup);
        startup = setTimeout(() => recover("startup-timeout"), 30_000);
        const engineModule = await loadWebGpuModule();
        if (closed || current !== generation) return;
        const container = video.parentElement;
        if (!engineModule || !container || container.tagName !== "DIV") { fail(time * 1000, "engine-unavailable"); return; }
        if (!sourceResolved) {
            playbackUrl = await resolveWebGpuSource(url, sourceAbort.signal);
            if (closed || current !== generation) return;
            sourceResolved = true;
        }
        subtitles.start(playbackUrl);
        const owned = engineModule.createEmbeddedPlayer({ video, container: container as HTMLDivElement }, {
            onState(state) {
                if (closed || current !== generation || !metadataSent) return;
                if (state === "playing") {
                    if (hdrAttempt) video.dataset.webgpuHdr = player?.stats()?.hdrOutput ? "hdr" : "sdr";
                    paused = false; ready = 4; emit("playing"); if (silent) emit("webgpu-audio-unavailable");
                }
                else if (state === "paused") { paused = true; emit("pause"); }
                else if (state === "ended") { paused = true; ended = true; emit("ended"); }
                else emit("waiting");
            },
            onTime(ms) {
                if (closed || current !== generation) return;
                const now = performance.now();
                if (now >= nextStatsSample) {
                    nextStatsSample = now + 1000;
                    lastStats = player?.stats() ?? lastStats;
                }
                if (!metadataSent || (seeking && seekTarget !== undefined && Math.abs(ms / 1000 - seekTarget) > .5)) return;
                time = ms / 1000;
                if (seeking) { seeking = false; seekTarget = undefined; emit("seeked"); }
                emit("timeupdate"); emit("progress");
            },
            onDuration(ms) { if (!closed && current === generation && ms !== null) { duration = ms / 1000; if (metadataSent) emit("durationchange"); } },
            onSubtitleBlocks(blocks) { if (!closed && current === generation) subtitles.supply(blocks); },
            onFallback(reason, atMs) { if (current === generation) recover(reason, atMs); },
            onError(reason) { if (current === generation) recover(reason); },
        });
        player = owned;
        // Each engine starts in SDR mode. Request extended output only when the
        // user enables it and the browser reports an HDR display.
        if (!hdrRejected && preferences.hdrOutput && typeof window !== "undefined"
            && window.matchMedia?.("(dynamic-range: high)").matches) {
            hdrAttempt = true;
            try { await owned.setHDROutput(true, preferences.hdrPeakNits); }
            catch { hdrRejected = true; hdrAttempt = false; hdrFallback("output-failed"); await owned.setHDROutput(false); }
            if (closed || current !== generation) { owned.destroy(); return; }
        } else if (!hdrRejected && preferences.hdrOutput) hdrFallback("display-unavailable");
        // A seek received before open is already covered by the opening position.
        pendingSeek = undefined;
        const result = await owned.open({ url: playbackUrl, startMs: time * 1000, paused: true, audioOrdinal: silent ? -1 : null, volume, muted, rate });
        // An open can complete after destroy while its initial file read settles.
        if (closed || current !== generation) { owned.destroy(); return; }
        if (!result.eligible) { recover(result.reason); return; }
        opened = true;
        tracks = silent ? [] : result.audio; selected = tracks.find(track => track.isDefault)?.ordinal ?? tracks[0]?.ordinal ?? null;
        width = result.width ?? 0; height = result.height ?? 0;
        duration = result.durationMs === null ? duration : result.durationMs / 1000;
        const preferred = preferredAudioTrack(tracks.map(track => ({ ...track, language: track.language || undefined, title: track.title || undefined })), readPlaybackPreferences().audioLanguage);
        if (preferred && preferred.ordinal !== selected) await selectAudio(preferred.ordinal);
        if (closed || current !== generation) return;
        clearTimeout(startup);
        ready = 2; metadataSent = true;
        video.dataset.webgpuAudio = silent ? "unavailable" : "available";
        listTracks(); emit("durationchange");
        if (!initialMetadata) { initialMetadata = true; emit("loadedmetadata"); }
        emit("loadeddata"); emit("canplay");
        if (pendingSeek !== undefined) { player.seek(pendingSeek * 1000); pendingSeek = undefined; }
        player.setVolume(volume); player.setMuted(muted); player.setRate(rate);
        if (!paused) player.play();
    };
    // Wait for the host to append the video and register its event listeners.
    void Promise.resolve().then(start).catch(() => recover("engine-initialization-failed"));
    return () => {
        if (fallbackMetadata) video.removeEventListener("loadedmetadata", fallbackMetadata);
        cleanup();
    };
}

function ranges(end: number): TimeRanges {
    const length = Number.isFinite(end) && end > 0 ? 1 : 0;
    const check = (index: number) => { if (!length || index !== 0) throw new DOMException("No media range", "IndexSizeError"); };
    return { length, start(index) { check(index); return 0; }, end(index) { check(index); return end; } };
}

function reasonCode(reason: string): string {
    return /^[a-z][a-z0-9-]{0,80}/i.exec(reason)?.[0] || "engine-failed";
}
