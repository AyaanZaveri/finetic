import { artworkSampleUrl } from "@/lib/artwork";
import { selectAuroraColors, DEFAULT_AURORA_COLORS } from "@/lib/aurora-palette";

const palettes = new Map<string, string[]>();
const pending = new Map<string, Promise<string[] | null>>();
const CACHE_LIMIT = 48;
let homeRequestKey = "";

/** Successful palettes are shared across route remounts and Strict Mode replay.
 * Failed requests are retryable; concurrent consumers share the same extraction. */
export function loadAuroraPalette(backdrop?: string, poster?: string): Promise<string[] | null> {
    return loadPalette(backdrop, poster, false);
}

export function loadHomePalette(primary?: string, fallback?: string): Promise<string[] | null> {
    if (!primary && !fallback) return Promise.resolve(null);
    return loadPalette(primary, fallback, true);
}

function loadPalette(backdrop: string | undefined, poster: string | undefined, home: boolean): Promise<string[] | null> {
    const sources = [
        ...(backdrop ? [{ url: backdrop, size: "w300" }] : []),
        ...(poster && poster !== backdrop ? [{ url: poster, size: "w342" }] : []),
    ];
    if (!sources.length) return Promise.resolve(DEFAULT_AURORA_COLORS);
    // Home uses population-based colors; detail pages retain their vibrant
    // Aurora palettes. A visit to either surface must not seed the other's cache.
    const key = `${home ? "home" : "aurora"}:${JSON.stringify(sources.flatMap(sampleSources))}`;
    const cached = palettes.get(key);
    if (cached) {
        palettes.delete(key);
        palettes.set(key, cached);
        return Promise.resolve(cached);
    }
    const pendingKey = key;
    if (home && homeRequestKey !== pendingKey) {
        // A → B → A must be allowed to resubmit A after B superseded its job.
        pending.delete(homeRequestKey);
        homeRequestKey = pendingKey;
    }
    const request = pending.get(pendingKey);
    if (request) return request;
    const extraction = home
        ? import("./palette-worker-client").then(module => module.extractHomePalette(sources.flatMap(sampleSources)))
        : extract(sources);
    const task = extraction.catch(() => null).then(colors => {
        if (colors) {
            palettes.set(key, colors);
            if (palettes.size > CACHE_LIMIT) palettes.delete(palettes.keys().next().value!);
        }
        return colors;
    }).finally(() => { if (pending.get(pendingKey) === task) pending.delete(pendingKey); });
    pending.set(pendingKey, task);
    return task;
}

async function extract(sources: { url: string; size: string }[]): Promise<string[] | null> {
    const { Vibrant } = await import("node-vibrant/browser");
    for (const source of sources.flatMap(sampleSources)) {
        const image = new Image();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            image.crossOrigin = "anonymous";
            image.src = source;
            const palette = await Promise.race([
                Vibrant.from(image).maxDimension(160).getPalette(),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error("Palette image timed out")), 4000);
                }),
            ]);
            const colors = selectAuroraColors(Object.values(palette).filter(swatch => swatch != null));
            if (colors) return colors;
        } catch {
            // A missing/tainted/stalled backdrop must not prevent the poster fallback.
        } finally {
            clearTimeout(timeout);
            image.src = "";
        }
    }
    return null;
}

function sampleSources({ url: source, size }: { url: string; size: string }): string[] {
    const sample = artworkSampleUrl(source);
    if (sample.startsWith("/api/artwork?")) {
        const params = new URLSearchParams(sample.slice(sample.indexOf("?") + 1));
        params.delete("width");
        params.set("palette", "1");
        const cached = `/api/artwork?${params}`;
        // Try the external cache first. Transfer bytes through our server only
        // if that service cannot supply a canvas-readable image.
        params.set("direct", "1");
        return [cached, `/api/artwork?${params}`];
    }
    // Palette extraction never needs an original-resolution TMDB download.
    if (/^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+\//.test(source)) {
        return [source.replace(/\/t\/p\/[^/]+\//, `/t/p/${size}/`)];
    }
    if (/^https?:\/\//i.test(source) && !/^https?:\/\/wsrv\.nl/i.test(source)) {
        return [sample, `https://wsrv.nl/?url=${encodeURIComponent(source.replace(/^https?:\/\//i, ""))}&w=300&h=300`];
    }
    return [sample];
}
