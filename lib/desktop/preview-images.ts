/** Native image addresses contain a per-session random token, never a media URL. */
export function nativePreviewUrl(src: string | null): boolean {
    const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/[a-f0-9]{32}\/\d+\.jpg$/.exec(src || "");
    return !!match && Number(match[1]) > 0 && Number(match[1]) <= 65535;
}

/** Own browser copies so a native-cache eviction cannot break a cached preview. */
export class PreviewImages {
    private images = new Map<string, { source: string; bytes: number }>();
    private pending = new Map<string, Promise<string | null>>();
    private controller = new AbortController();
    private bytes = 0;
    constructor(private evict: (_url: string) => void, private capacity = 256, private maxBytes = 16 * 1024 * 1024) {}
    has(url: string) { return this.images.has(url); }
    touch(url: string) {
        const entry = this.images.get(url);
        if (entry) { this.images.delete(url); this.images.set(url, entry); }
    }
    get(source: string): Promise<string | null> {
        if (!nativePreviewUrl(source) || typeof fetch === "undefined") return Promise.resolve(null);
        for (const [url, image] of this.images) if (image.source === source) { this.touch(url); return Promise.resolve(url); }
        const existing = this.pending.get(source);
        if (existing) return existing;
        const signal = this.controller.signal;
        const work = (async () => {
            try {
                const response = await fetch(source, { credentials: "omit", cache: "no-store", signal });
                if (!response.ok || response.headers.get("content-type") !== "image/jpeg") return null;
                const blob = await response.blob();
                if (signal.aborted || !blob.size || blob.size > Math.min(this.maxBytes, 2 * 1024 * 1024)) return null;
                const url = URL.createObjectURL(blob);
                this.images.set(url, { source, bytes: blob.size }); this.bytes += blob.size;
                while (this.images.size > this.capacity || this.bytes > this.maxBytes) this.remove(this.images.keys().next().value!);
                return this.images.has(url) ? url : null;
            } catch { return null; }
        })();
        this.pending.set(source, work);
        void work.finally(() => { if (this.pending.get(source) === work) this.pending.delete(source); });
        return work;
    }
    private remove(url: string) {
        const image = this.images.get(url);
        if (!image) return;
        this.bytes -= image.bytes; this.images.delete(url);
        URL.revokeObjectURL(url); this.evict(url);
    }
    clear() {
        this.controller.abort(); this.controller = new AbortController(); this.pending.clear();
        for (const url of [...this.images.keys()]) this.remove(url);
    }
}
