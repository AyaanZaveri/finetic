import { loadWebGpuModule, type WebGpuAudioTrack, type WebGpuPlayer, type WebGpuStats } from "./webgpu-module";
import { resolveWebGpuSource } from "./webgpu-source";
import { createWebGpuSubtitles } from "./webgpu-subtitles";
import { preferredAudioTrack } from "./audio-language";
import { readPlaybackPreferences } from "./playback-preferences";

export type WebGpuVideo = HTMLVideoElement & { webgpu?: {
    readonly silent: boolean; stats(): WebGpuStats | null; picture(): HTMLCanvasElement | null; subtitle(_time: number): string | null;
} };

const SEEK_TIMEOUT_MS = 12_000;

/** Keep one real video element registered with the controls. Its media API drives
 * the embedded engine until a same-file fallback restores the browser API. */
export function attachWebGpuVideo(video: WebGpuVideo, url: string, fallback: (_source: string) => void, startPosition = 0): () => void {
    let player: WebGpuPlayer | undefined;
    let lastStats: WebGpuStats | null = null;
    let nextStatsSample = 0;
    let closed = false, opened = false, metadataSent = false, silent = false;
    let generation = 0, initialMetadata = false, initialData = false;
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
    let seekQueued = false;
    let seekRetried = false;
    let seekFrame: number | undefined;
    let seekTimeout: ReturnType<typeof setTimeout> | undefined;
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
    const clearSeekWatch = () => {
        if (seekFrame !== undefined) cancelAnimationFrame(seekFrame);
        clearTimeout(seekTimeout);
        seekFrame = seekTimeout = undefined;
    };
    const cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(startup); clearSeekWatch(); sourceAbort.abort(); subtitles.dispose();
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
        if (seeking && initialMetadata) {
            if (preferences.hdrOutput) video.dataset.webgpuHdr = "browser-fallback";
            emit("webgpu-seek-fallback");
        } else hdrFallback("browser-fallback");
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
    const watchSeek = (owned: WebGpuPlayer, seekInPlace: boolean) => {
        clearSeekWatch();
        // The decoder signals the new clock position before any frame arrives.
        // Count a fresh presentation even when it has the same timestamp.
        const baseline = seekInPlace ? owned.presentedMs() : null;
        const frameCount = seekInPlace ? owned.stats()?.framesPresented ?? 0 : 0;
        const check = () => {
            const picture = owned.presentedMs();
            if (picture === null || (picture === baseline && (owned.stats()?.framesPresented ?? 0) <= frameCount)) {
                seekFrame = requestAnimationFrame(check);
                return;
            }
            clearSeekWatch();
            seeking = false;
            ready = paused ? 2 : 4;
            emit("seeked");
            emit("timeupdate");
            emit("progress");
            reportReady();
            if (!paused) reportPlaying();
        };
        const expire = () => {
            // The presenter can suspend frame delivery in a background tab.
            if (document.hidden) {
                seekTimeout = setTimeout(expire, SEEK_TIMEOUT_MS);
                return;
            }
            recover("seek-timeout");
        };
        seekFrame = requestAnimationFrame(check);
        seekTimeout = setTimeout(expire, SEEK_TIMEOUT_MS);
        if (seekInPlace) {
            try { owned.seek(time * 1000); }
            catch { recover("seek-failed"); }
        }
    };
    const reportReady = () => {
        if (!initialData) { initialData = true; emit("loadeddata"); }
        emit("canplay");
    };
    const reportPlaying = () => {
        if (hdrAttempt) video.dataset.webgpuHdr = player?.stats()?.hdrOutput ? "hdr" : "sdr";
        emit("playing");
        if (silent) emit("webgpu-audio-unavailable");
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
        ended = false; seeking = true; seekRetried = false;
        if (metadataSent) ready = 1;
        emit("seeking");
        if (!closed && metadataSent) emit("waiting");
        seekQueued = !metadataSent;
        if (metadataSent && player) watchSeek(player, true);
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
            const presented = seeking ? null : player?.presentedMs() ?? null;
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
        } catch {
            if (current === generation) recover("audio-track-switch-failed");
        } finally { switching = false; }
    };
    const recover = (reason: string, atMs = time * 1000) => {
        if (closed) return;
        const resumeMs = !metadataSent || seeking ? time * 1000 : atMs;
        video.dataset.webgpuReason = reasonCode(reason);
        const outputError = /^(?:canvas-|color-pipeline-|decoded-frame-color-|dolby-vision-|frame-(?:import|presentation|render)-|pipeline-creation-|hdr-)/i.test(reason);
        const retrySdr = hdrAttempt && !hdrRejected && (!initialMetadata || outputError);
        const retrySeek = seeking && initialMetadata && !seekRetried && !retrySdr;
        const retrySilent = (!seeking || !initialMetadata) && !silent && player
            && /audio|decode-failed|start-fallback|startup-timeout|route-start-failed/i.test(reason);
        if (retrySeek || retrySdr || retrySilent) {
            if (retrySdr) { hdrRejected = true; hdrAttempt = false; hdrFallback("output-failed"); }
            else if (retrySeek) seekRetried = true;
            else silent = true;
            clearSeekWatch();
            opened = false; metadataSent = false; ready = initialMetadata ? 1 : 0;
            time = Math.max(0, resumeMs / 1000);
            generation++; // Invalidate the failed route before synchronous teardown callbacks.
            const failed = player;
            player = undefined;
            failed?.destroy();
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
                if (closed || current !== generation || !metadataSent || seeking) return;
                if (state === "playing") {
                    paused = false; ready = 4; reportPlaying();
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
                if (!metadataSent || seeking) return;
                time = ms / 1000;
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
        seekQueued = false;
        const audioOrdinal = silent ? -1 : selected;
        const result = await owned.open({ url: playbackUrl, startMs: time * 1000, paused: true, audioOrdinal, volume, muted, rate });
        // An open can complete after destroy while its initial file read settles.
        if (closed || current !== generation) { owned.destroy(); return; }
        if (!result.eligible) { recover(result.reason); return; }
        opened = true;
        tracks = silent ? [] : result.audio; selected = tracks.find(track => track.isDefault)?.ordinal ?? tracks[0]?.ordinal ?? null;
        if (tracks.some(track => track.ordinal === audioOrdinal)) selected = audioOrdinal;
        width = result.width ?? 0; height = result.height ?? 0;
        duration = result.durationMs === null ? duration : result.durationMs / 1000;
        const preferred = preferredAudioTrack(tracks.map(track => ({ ...track, language: track.language || undefined, title: track.title || undefined })), readPlaybackPreferences().audioLanguage);
        if (audioOrdinal === null && preferred && preferred.ordinal !== selected) await selectAudio(preferred.ordinal);
        if (closed || current !== generation) return;
        clearTimeout(startup);
        ready = seeking ? 1 : 2; metadataSent = true;
        video.dataset.webgpuAudio = silent ? "unavailable" : "available";
        listTracks(); emit("durationchange");
        if (!initialMetadata) { initialMetadata = true; emit("loadedmetadata"); }
        if (closed || current !== generation) return;
        if (!seeking) reportReady();
        else if (seekFrame === undefined) {
            const seekInPlace = seekQueued;
            seekQueued = false;
            watchSeek(owned, seekInPlace);
        }
        if (closed || current !== generation) return;
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
