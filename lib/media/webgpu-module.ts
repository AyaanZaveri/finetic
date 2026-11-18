import { readPlaybackPreferences } from "./playback-preferences";
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
    hdrOutput?: boolean;
    framesPresented: number; framesDropped: number;
    audio: unknown | null; audioAheadMs: number | null; clockMs: number;
}
export interface WebGpuPlayer {
    open(_request: { url: string; startMs: number; paused: boolean; audioOrdinal: number | null;
        volume: number; muted: boolean; rate: number }): Promise<WebGpuOpened>;
    play(): void; pause(): void; seek(_ms: number): void;
    setVolume(_value: number): void; setMuted(_value: boolean): void; setRate(_value: number): void;
    setAudio(_ordinal: number): Promise<WebGpuOpened>;
    setHDROutput(_enabled: boolean, _peakNits?: number): Promise<void>;
    presentedMs(): number | null; stats(): WebGpuStats | null; destroy(): void;
}
export interface WebGpuSubtitleBlock { trackNumber: number; timestampMs: number; durationMs: number | null; data: Uint8Array }
export interface WebGpuEvents {
    onState(_state: "loading" | "playing" | "paused" | "waiting" | "ended"): void;
    onTime(_ms: number): void; onDuration(_ms: number | null): void;
    onSubtitleBlocks?(_blocks: readonly WebGpuSubtitleBlock[]): void;
    onFallback(_reason: string, _atMs: number): void; onError(_message: string): void;
}
export interface WebGpuModule {
    isEmbeddedPlayerSupported(): boolean;
    createEmbeddedPlayer(_surface: { container: HTMLDivElement; video: HTMLVideoElement }, _events: WebGpuEvents): WebGpuPlayer;
}

/** HLS, DASH, and live playlists stay on the existing media-element path. */
export function canUseWebGpu(url: string): boolean {
    if (!readPlaybackPreferences().webGpuPlayback) return false;
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
        const url = new URL(`/webgpu-player/${manifest.version}/libraries/webgpu-player/EmbeddedPlayer.js?adapter=4`, location.href).href;
        // The module resolves its workers and WASM relative to its own URL.
        loading = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)
            .then((module: WebGpuModule) => module.isEmbeddedPlayerSupported() ? module : null)
            .catch(() => { loading = undefined; return null; });
    }
    return loading;
}
