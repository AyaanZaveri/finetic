import type { MediaToPlay } from "@/lib/atoms";
import { desktopBridge } from "@/lib/desktop/bridge";
import type { EpisodePreload } from "./episode-continuation";
import { preloadWebVideo } from "./web-video-preload";
import { resolveMediaFlowSource } from "./mediaflow-source";
import { readPlaybackPreferences } from "./playback-preferences";

export function videoPreloadAllowed(node?: HTMLVideoElement | null, seconds = 20): boolean {
    if (!node || node.paused || node.seeking || node.readyState < 3 || document.visibilityState === "hidden") return false;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return false;
    // A fully buffered ending is healthy even when fewer than 20 seconds
    // remain; do not discard the next episode just before its handoff.
    const remaining = Number.isFinite(node.duration) && node.duration > node.currentTime ? node.duration - node.currentTime : Infinity;
    const needed = Math.min(seconds, remaining);
    for (let i = 0; i < node.buffered.length; i++) {
        if (node.buffered.start(i) <= node.currentTime && node.buffered.end(i) - node.currentTime >= needed) return true;
    }
    return false;
}

export function releaseNativePreload(url: string) {
    try {
        const target = new URL(url);
        if (target.origin !== location.origin || target.pathname !== "/api/playback/preload") return;
        target.searchParams.set("active", "1");
        void fetch(target, { method: "DELETE", keepalive: true }).catch(() => {});
    } catch { /* Best effort; the bounded server cache also expires. */ }
}

export async function preloadNextVideo(media: MediaToPlay, native: boolean, duration: number, signal: AbortSignal): Promise<EpisodePreload | void> {
    if (!media.streamUrl || signal.aborted) return;
    if (!native) {
        if (Object.keys(media.requestHeaders || {}).length) return;
        const preferences = readPlaybackPreferences();
        const source = preferences.mediaFlowMode && preferences.mediaFlowMode !== "off"
            ? await resolveMediaFlowSource(media.streamUrl, signal, preferences) : media.streamUrl;
        return preloadWebVideo(source, signal);
    }
    // The packaged desktop already owns a loopback Next server. Reuse it rather
    // than spawning another mpv decoder or relying on WebKit's unrelated cache.
    if (!["macos", "windows", "linux"].includes(desktopBridge()?.platform || "")
    || location.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
    || /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(media.streamUrl)) return;
    const bytes = media.subtitleVideoSize && duration > 0 ? Math.ceil(media.subtitleVideoSize / duration * 8) : 8 * 1024 * 1024;
    const response = await fetch("/api/playback/preload", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: media.streamUrl, headers: media.requestHeaders, bytes }), signal });
    if (response.status !== 200) return;
    const { token } = await response.json();
    if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) return;
    const url = new URL("/api/playback/preload", location.origin); url.searchParams.set("token", token);
    let claimed = false;
    const dispose = () => {
        signal.removeEventListener("abort", dispose);
        if (!claimed) void fetch(url, { method: "DELETE", keepalive: true }).catch(() => {});
    };
    if (signal.aborted) { dispose(); return; }
    signal.addEventListener("abort", dispose, { once: true });
    return { claim() {
        claimed = true; signal.removeEventListener("abort", dispose);
        media.nativePreload = { url: url.href, source: media.streamUrl!, expires: Date.now() + 6 * 60_000 };
    }, dispose };
}
