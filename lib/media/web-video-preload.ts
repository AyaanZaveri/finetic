import { canUseWebGpu } from "./webgpu-module";
import { attachWebGpuVideo } from "./webgpu-video";
import { getWebPlaybackElement } from "./playback-source";
import { initialize, teardown as teardownMux } from "@mux/playback-core";

export const VIDEO_PRELOAD_SECONDS = 8;
export const VIDEO_PRELOAD_BYTES = 32 * 1024 * 1024;
type Core = ReturnType<typeof import("@mux/playback-core")["initialize"]>;
export interface WebVideoSession {
  video: HTMLVideoElement;
  activate(): void;
  stopLoading(): void;
  dispose(): void;
}
let pending: { url: string; session: WebVideoSession; claimed: boolean; timer: ReturnType<typeof setTimeout>; release(): void } | undefined;

/** One paused, unmounted media element. Adoption moves this exact element and
 * its Mux engine into the player; changing src would discard the buffer. */
export function createWebVideoSession(url: string, speculative = false): WebVideoSession {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous"; video.playsInline = true;
    video.preload = "auto"; video.autoplay = false;
    let core: Core | undefined;
    let teardown: typeof import("@mux/playback-core")["teardown"] | undefined;
    let disposed = false;
    const startNative = () => {
        if (disposed) return;
        if (getWebPlaybackElement(url) === "mux") {
            teardown = teardownMux;
            core = initialize({ src: url, autoplay: false, preload: "auto", disableTracking: true,
                ...(speculative ? { _hlsConfig: { maxBufferLength: VIDEO_PRELOAD_SECONDS, maxMaxBufferLength: VIDEO_PRELOAD_SECONDS,
                    maxBufferSize: VIDEO_PRELOAD_BYTES, backBufferLength: 0, maxBufferHole: .5 } } : {}),
            }, video);
        } else { video.src = url; video.load(); }
    };
    const detachGpu = !speculative && canUseWebGpu(url) ? attachWebGpuVideo(video, url, startNative) : undefined;
    if (!detachGpu) startNative();
    const stop = () => {
        if (speculative && video.buffered.length && video.buffered.end(video.buffered.length - 1) >= VIDEO_PRELOAD_SECONDS) {
            // HLS can stop loading without detaching MediaSource or dropping packets.
            core?.engine?.stopLoad();
            if (!core?.engine) video.preload = "metadata";
        }
    };
    video.addEventListener("progress", stop);
    return {
        video,
        stopLoading() { core?.engine?.stopLoad(); video.preload = "metadata"; },
        activate() {
            speculative = false;
            video.preload = "auto";
            if (core?.engine) {
                // Restore Mux's normal playback budgets after the speculative phase.
                const defaults = core.engine.constructor as { DefaultConfig?: { maxBufferLength: number; maxMaxBufferLength: number; maxBufferSize: number; backBufferLength: number } };
                if (defaults.DefaultConfig) for (const key of ["maxBufferLength", "maxMaxBufferLength", "maxBufferSize", "backBufferLength"] as const) {
                    core.engine.config[key] = defaults.DefaultConfig[key];
                }
                core.engine.startLoad();
            }
            video.removeEventListener("progress", stop);
        },
        dispose() {
            if (disposed) return; disposed = true;
            video.removeEventListener("progress", stop); detachGpu?.(); video.pause();
            teardown?.(video, core); video.removeAttribute("src"); video.load(); video.remove();
        },
    };
}

export async function preloadWebVideo(url: string, signal: AbortSignal) {
    if (pending) pending.release();
    // A native standby cannot be adopted by the GPU decoder. Do not download
    // a second opening buffer that the active engine would have to discard.
    if (canUseWebGpu(url)) return;
    const session = createWebVideoSession(url, true);
    if (signal.aborted) { session.dispose(); return; }
    let claimed = false;
    const release = () => {
        signal.removeEventListener("abort", release);
        if (claimed) return;
        clearTimeout(timer); clearTimeout(stopTimer);
        if (pending?.session === session) { clearTimeout(pending.timer); pending = undefined; }
        session.dispose();
    };
    // Native <video> preload is a browser hint without a strict byte budget.
    // Bound speculative time as well; the browser may buffer less than 8 seconds.
    const stopTimer = setTimeout(() => session.stopLoading(), 20_000);
    const timer = setTimeout(release, 6 * 60_000);
    pending = { url, session, claimed: false, timer, release };
    signal.addEventListener("abort", release, { once: true });
    return {
        claim() {
            if (pending?.session !== session) return;
            claimed = true; pending.claimed = true; clearTimeout(timer); clearTimeout(stopTimer);
            signal.removeEventListener("abort", release);
            pending.timer = setTimeout(() => {
                if (pending?.session === session) { pending = undefined; session.dispose(); }
            }, 15_000);
        },
        dispose: release,
    };
}

export function takeWebVideo(url: string): WebVideoSession | undefined {
    if (!pending?.claimed || pending.url !== url) return;
    const { session, timer } = pending; pending = undefined; clearTimeout(timer);
    session.activate(); return session;
}
