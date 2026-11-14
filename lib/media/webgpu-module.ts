import manifest from "@aiostreams/webgpu-player/package.json";

export interface WebGpuAudioTrack {
    ordinal: number; codec: string | null; channels: number | null;
    language: string | null; title: string | null; isDefault: boolean;
}
export type WebGpuOpened = { eligible: false; reason: string } | {
    eligible: true; audio: readonly WebGpuAudioTrack[]; audioOrdinal: number | null;
    width: number | null; height: number | null; durationMs: number | null; route: string;
};
export interface WebGpuStats {
    framesPresented: number; framesDropped: number;
    audio: unknown | null; audioAheadMs: number | null; clockMs: number;
}
export interface WebGpuPlayer {
    open(request: { url: string; startMs: number; paused: boolean; audioOrdinal: number | null;
        volume: number; muted: boolean; rate: number }): Promise<WebGpuOpened>;
    play(): void; pause(): void; seek(ms: number): void;
    setVolume(value: number): void; setMuted(value: boolean): void; setRate(value: number): void;
    setAudio(ordinal: number): Promise<WebGpuOpened>;
    presentedMs(): number | null; stats(): WebGpuStats | null; destroy(): void;
}
export interface WebGpuEvents {
    onState(state: "loading" | "playing" | "paused" | "waiting" | "ended"): void;
    onTime(ms: number): void; onDuration(ms: number | null): void;
    onFallback(reason: string, atMs: number): void; onError(message: string): void;
}
export interface WebGpuModule {
    isEmbeddedPlayerSupported(): boolean;
    createEmbeddedPlayer(surface: { container: HTMLDivElement; video: HTMLVideoElement }, events: WebGpuEvents): WebGpuPlayer;
}

/** HLS, DASH, and live playlists stay on the existing media-element path. */
export function canUseWebGpu(url: string): boolean {
    if (typeof window === "undefined" || !window.isSecureContext || !("gpu" in navigator)
        || typeof VideoDecoder === "undefined" || typeof AudioWorkletNode === "undefined") return false;
    try {
        const parsed = new URL(url, location.href);
        return /^https?:$/.test(parsed.protocol) && !/\.(m3u8|mpd)(?:$|\/)/i.test(parsed.pathname);
    } catch { return false; }
}

let loading: Promise<WebGpuModule | null> | undefined;
export function loadWebGpuModule(): Promise<WebGpuModule | null> {
    if (!loading) {
        const url = new URL(`/webgpu-player/${manifest.version}/libraries/webgpu-player/EmbeddedPlayer.js`, location.href).href;
        // The module resolves its workers and WASM relative to its own URL.
        loading = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)
            .then((module: WebGpuModule) => module.isEmbeddedPlayerSupported() ? module : null)
            .catch(() => { loading = undefined; return null; });
    }
    return loading;
}
