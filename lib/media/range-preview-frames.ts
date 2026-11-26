import { resolveWebGpuSource } from './webgpu-source';
import { PreviewCache } from './preview-frames';
import type { CanvasSink, EncodedPacketSink, Input } from 'mediabunny';

const MAX_KEYFRAME_RANGES = 256;

/** Sparse WebCodecs decoding avoids a second full-size HTML video playback pipeline. */
export class RangePreviewFrames {
    private cache = new PreviewCache(256, src => URL.revokeObjectURL(src));
    private keyframeRanges = new Map<number, number>();
    private packets?: EncodedPacketSink;
    private input?: Input;
    private sink?: CanvasSink;
    private wanted: number | null = null;
    private running = false;
    private closed = false;
    private timer?: ReturnType<typeof setTimeout>;
    private opening?: Promise<CanvasSink | undefined>;
    private abort = new AbortController();
    private source: string;
    private ready: (_time: number, _src: string | null) => void;
    private unavailable: () => void;
    private exact: boolean;
    constructor(source: string, ready: (_time: number, _src: string | null) => void, unavailable: () => void, exact = false) {
        this.source = source; this.ready = ready; this.unavailable = unavailable;
        this.exact = exact;
    }
    cached(time: number) {
        return this.cache.get(time) ?? this.keyframeAt(time);
    }
    private keyframeAt(time: number) {
        for (const [start, end] of this.keyframeRanges) {
            if (time >= start && time <= end) return this.cache.get(start);
        }
    }
    want(time: number) {
        if (this.closed || this.wanted === time) return;
        this.wanted = time;
        const cached = this.cached(time);
        if (cached) this.ready(time, cached);
        else void this.pump();
    }
    cancel() { this.wanted = null; }
    /** Warm the demuxer after playback starts, without decoding or scanning frames. */
    async prepare() { try { await this.initialize(); } catch { this.fail(); } }
    private initialize() { return this.opening ??= this.open(); }
    private async open() {
        const [module, source] = await Promise.all([
            import('mediabunny'), resolveWebGpuSource(this.source, AbortSignal.any([this.abort.signal, AbortSignal.timeout(5_000)])),
        ]);
        const { Input, UrlSource, CanvasSink, EncodedPacketSink, MP4, MATROSKA, WEBM, QTFF } = module;
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
                // The demuxer skips size inference whenever Content-Encoding
                // exists. MediaFlow can send "identity" for unencoded ranges.
                if (response.status === 206 && response.headers.get('Content-Encoding')?.trim().toLowerCase() === 'identity') {
                    const headers = new Headers(response.headers);
                    headers.delete('Content-Encoding');
                    const unencoded = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
                    // Keep the final URL available to the demuxer after a redirect.
                    if (response.redirected) Object.defineProperties(unencoded, {
                        redirected: { value: true }, url: { value: response.url },
                    });
                    return unencoded;
                }
                return response;
            }) as typeof fetch,
        }) });
        const track = await this.input.getPrimaryVideoTrack();
        if (!track || !await track.canDecode()) throw new Error('WebCodecs cannot decode this stream');
        if (this.closed) return;
        const width = await track.getDisplayWidth(), height = await track.getDisplayHeight();
        if (this.closed) return;
        if (!this.exact) this.packets = new EncodedPacketSink(track);
        const scale = Math.min(448 / width, 252 / height, 1);
        this.sink = new CanvasSink(track, { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)),
            fit: 'contain', poolSize: 1, decoderOptions: { optimizeForLatency: true } });
        return this.sink;
    }
    private async extract(sink: CanvasSink, time: number) {
        const cached = this.cached(time);
        if (cached) return cached;

        // Looking up metadata avoids reading a keyframe's payload just to find
        // out that we already decoded it for a nearby pointer position.
        const keyframe = this.exact ? undefined : await this.packets?.getKeyPacket(time, { metadataOnly: true });
        if (this.closed) return;
        const start = keyframe?.timestamp ?? time;
        let src = this.cache.get(start);
        let decodedAt = start;
        if (!src) {
            let frame = await sink.getCanvas(start);
            if (this.closed) return;
            if (!frame && start !== time) {
                decodedAt = time;
                frame = await sink.getCanvas(time);
            }
            if (this.closed) return;
            if (!frame) {
                if (this.exact) return null;
                throw new Error('No frame at the requested time');
            }
            const { canvas } = frame;
            const blob = 'convertToBlob' in canvas
                ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
                : await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
            if (this.closed) return;
            if (!blob) throw new Error('Preview encoding unavailable');
            src = URL.createObjectURL(blob);
            this.cache.set(decodedAt, src, blob.size);
        }
        if (keyframe && decodedAt === start && start <= time) {
            const end = Math.max(time, this.keyframeRanges.get(start) ?? start);
            this.keyframeRanges.delete(start);
            this.keyframeRanges.set(start, end);
            if (this.keyframeRanges.size > MAX_KEYFRAME_RANGES) this.keyframeRanges.delete(this.keyframeRanges.keys().next().value!);
        }
        return src;
    }
    private async pump() {
        if (this.running || this.closed || this.wanted === null) return;
        this.running = true;
        this.timer = setTimeout(() => this.fail(), 6_000);
        try {
            const sink = await this.initialize();
            while (sink && !this.closed && this.wanted !== null) {
                const time: number = this.wanted;
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.fail(), 6_000);
                const src = await this.extract(sink, time);
                const selected = this.wanted;
                if (this.closed || src === undefined || selected === null) break;
                const latest = this.cached(selected);
                if (latest) this.ready(selected, latest);
                else this.ready(time, src);
                if (selected === time) break;
                // Skip obsolete requests without starting parallel decoders.
            }
        } catch { if (!this.closed) this.fail(); }
        finally { clearTimeout(this.timer); this.timer = undefined; this.running = false; }
    }
    private fail() { if (!this.closed) { this.dispose(); this.unavailable(); } }
    dispose() {
        this.closed = true; this.cancel(); this.abort.abort();
        clearTimeout(this.timer); this.timer = undefined;
        this.input?.dispose(); this.cache.clear(); this.keyframeRanges.clear();
    }
}
