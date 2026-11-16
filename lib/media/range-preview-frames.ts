import { resolveWebGpuSource } from './webgpu-source';
import { PreviewCache } from './preview-frames';
import type { CanvasSink, Input } from 'mediabunny';

/** Sparse WebCodecs decoding avoids a second full-size HTML video playback pipeline. */
export class RangePreviewFrames {
    readonly cache = new PreviewCache(256, src => URL.revokeObjectURL(src));
    private input?: Input;
    private sink?: CanvasSink;
    private wanted: number | null = null;
    private running = false;
    private closed = false;
    private timer?: ReturnType<typeof setTimeout>;
    private opening?: Promise<CanvasSink | undefined>;
    private abort = new AbortController();
    private source: string;
    private ready: (_time: number, _src: string) => void;
    private unavailable: () => void;
    constructor(source: string, ready: (_time: number, _src: string) => void, unavailable: () => void) {
        this.source = source; this.ready = ready; this.unavailable = unavailable;
    }
    want(time: number) {
        if (this.closed) return;
        this.wanted = time;
        const cached = this.cache.get(time);
        if (cached) { this.ready(time, cached); return; }
        void this.pump();
    }
    cancel() { this.wanted = null; }
    /** Warm the demuxer after playback starts, without decoding or scanning frames. */
    async prepare() { try { await this.initialize(); } catch { this.fail(); } }
    private initialize() { return this.opening ??= this.open(); }
    private async open() {
        const [module, source] = await Promise.all([
            import('mediabunny'), resolveWebGpuSource(this.source, AbortSignal.any([this.abort.signal, AbortSignal.timeout(5_000)])),
        ]);
        const { Input, UrlSource, CanvasSink, MP4, MATROSKA, WEBM, QTFF } = module;
        if (this.closed) return;
        this.input = new Input({ formats: [MP4, MATROSKA, WEBM, QTFF], source: new UrlSource(source, {
            maxCacheSize: 16 * 1024 * 1024, parallelism: 2,
            getRetryDelay: attempts => attempts < 1 ? 0.5 : null,
            handleUnhandledError: () => this.fail(),
            fetchFn: (async (...args: Parameters<typeof fetch>) => {
                const [url, options] = args;
                const signals = [this.abort.signal, AbortSignal.timeout(5_000)];
                if (options?.signal) signals.push(options.signal);
                const response = await fetch(url, { ...options, signal: AbortSignal.any(signals) });
                // Do not download a multi-GB body from a server ignoring Range.
                if (response.ok && response.status !== 206 && new Headers(options?.headers).has('Range')) {
                    await response.body?.cancel();
                    throw new Error('Thumbnail extraction requires HTTP ranges');
                }
                return response;
            }) as typeof fetch,
        }) });
        const track = await this.input.getPrimaryVideoTrack();
        if (!track || !await track.canDecode()) throw new Error('WebCodecs cannot decode this stream');
        if (this.closed) return;
        const width = await track.getDisplayWidth(), height = await track.getDisplayHeight();
        if (this.closed) return;
        const scale = Math.min(448 / width, 252 / height, 1);
        this.sink = new CanvasSink(track, { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)),
            fit: 'contain', poolSize: 1, decoderOptions: { optimizeForLatency: true } });
        return this.sink;
    }
    private async pump() {
        if (this.running || this.closed || this.wanted === null) return;
        this.running = true;
        this.timer = setTimeout(() => this.fail(), 6_000);
        try {
            const sink = await this.initialize();
            while (sink && !this.closed && this.wanted !== null) {
                const time: number = this.wanted;
                const cached = this.cache.get(time);
                if (cached) { this.ready(time, cached); break; }
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.fail(), 6_000);
                const result = await sink.getCanvas(time);
                if (this.closed) break;
                if (!result) throw new Error('No frame at the requested time');
                // Encode asynchronously and keep binary JPEGs. Do not copy the
                // canvas or create large base64 strings on the pointer path.
                const canvas = result.canvas;
                const blob = 'convertToBlob' in canvas
                    ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
                    : await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
                if (this.closed) break;
                if (!blob) throw new Error('Preview encoding unavailable');
                const src = URL.createObjectURL(blob);
                this.cache.set(time, src, blob.size);
                if (this.wanted !== null) {
                    const selected = this.cache.get(this.wanted);
                    this.ready(selected ? this.wanted : time, selected || src);
                }
                if (this.wanted === time) break;
                // A moving pointer skips obsolete positions; no parallel decoders.
            }
        } catch { if (!this.closed) this.fail(); }
        finally { clearTimeout(this.timer); this.timer = undefined; this.running = false; }
    }
    private fail() { if (!this.closed) { this.dispose(); this.unavailable(); } }
    dispose() {
        this.closed = true; this.wanted = null; this.abort.abort();
        clearTimeout(this.timer); this.timer = undefined;
        this.input?.dispose(); this.cache.clear();
    }
}
