import type { Input, InputTrack } from "mediabunny";
import type { StremioStream } from "@/types/stremio";
import { resolveMediaFlowSource } from "./mediaflow-source";
import { readPlaybackPreferences } from "./playback-preferences";

export interface StreamTrackMetadata {
    codec: string | null;
    codecString: string | null;
    internalCodecId: string | null;
    primary?: boolean;
    language?: string;
    channels?: number;
}
export interface StreamMetadata {
    mimeType: string;
    video: StreamTrackMetadata | null;
    audio: StreamTrackMetadata[];
}
export interface StreamProbeBudget { remainingBytes: number; }

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { expires: number; metadata: StreamMetadata | undefined }>();
const inFlight = new Map<string, Promise<StreamMetadata | undefined>>();

/** Read container headers only. A failed/blocked probe is unknown, never evidence of an incompatible file. */
export async function probeStreamMetadata(stream: StremioStream, options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    fetchFn?: typeof fetch;
    budget?: StreamProbeBudget;
} = {}): Promise<StreamMetadata | undefined> {
    let url = stream.url;
    if (!url || options.signal?.aborted || Object.keys(stream.behaviorHints?.proxyHeaders?.request || {}).length) return;
    const preferences = readPlaybackPreferences();
    if (preferences.mediaFlowMode && preferences.mediaFlowMode !== "off") {
        try { url = await resolveMediaFlowSource(url, options.signal ?? AbortSignal.timeout(15_000), preferences); }
        catch { return; }
    }
    const fileKey = stream.infoHash ? JSON.stringify([stream.infoHash.toLowerCase(), stream.fileIdx ?? stream.behaviorHints?.filename ?? "largest", stream.behaviorHints?.videoSize]) : url;
    const cached = cache.get(fileKey) || cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.metadata;
    // Keep cancellation local to each caller; unrelated loads must not inherit an aborted request.
    if (!options.signal && !options.budget && inFlight.has(fileKey)) return inFlight.get(fileKey);
    const operation = inspect(url, options).then(metadata => {
        if (options.signal?.aborted || (!metadata && options.budget?.remainingBytes === 0)) return metadata;
        cache.set(metadata ? fileKey : url, { metadata, expires: Date.now() + (metadata ? CACHE_TTL_MS : 30_000) });
        while (cache.size > 128) cache.delete(cache.keys().next().value!);
        return metadata;
    });
    if (!options.signal && !options.budget) inFlight.set(fileKey, operation);
    try { return await operation; }
    finally { if (inFlight.get(fileKey) === operation) inFlight.delete(fileKey); }
}

async function inspect(url: string, options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; fetchFn?: typeof fetch; budget?: StreamProbeBudget }): Promise<StreamMetadata | undefined> {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
    let input: Input | undefined;
    let requests = 0, bytes = 0;
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    let onAbort: () => void = () => {};
    const aborted = new Promise<undefined>(resolve => { onAbort = () => resolve(undefined); signal.addEventListener("abort", onAbort, { once: true }); });
    const operation = (async () => {
        const { Input, UrlSource, MP4, MATROSKA, WEBM, QTFF } = await import("mediabunny");
        if (signal.aborted) return;
        input = new Input({ formats: [MP4, MATROSKA, WEBM, QTFF], source: new UrlSource(url, {
            maxCacheSize: maxBytes, parallelism: 1, getRetryDelay: () => null,
            fetchFn: (async (resource: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                const allowance = Math.min(maxBytes - bytes, options.budget?.remainingBytes ?? Infinity);
                if (++requests > 8 || allowance <= 0) throw new Error("Metadata request budget exceeded");
                const headers = new Headers(init?.headers);
                const range = /^bytes=(\d+)-(\d*)$/i.exec(headers.get("Range") || "");
                if (!range) throw new Error("Metadata inspection requires byte ranges");
                const start = Number(range[1]);
                const end = Math.min(range[2] ? Number(range[2]) : Infinity, start + Math.min(256 * 1024, allowance) - 1);
                headers.set("Range", `bytes=${start}-${end}`);
                const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
                const response = await (options.fetchFn || fetch)(resource, { ...init, headers, signal: requestSignal });
                if (response.status !== 206 || !response.body) {
                    await response.body?.cancel();
                    throw new Error("Server did not honor the metadata range request");
                }
                const reader = response.body.getReader();
                const body = new ReadableStream<Uint8Array>({
                    async pull(target) {
                        const result = await reader.read();
                        if (result.done) { target.close(); return; }
                        bytes += result.value.byteLength;
                        if (options.budget) {
                            const prior = options.budget.remainingBytes;
                            options.budget.remainingBytes = Math.max(0, prior - result.value.byteLength);
                            if (result.value.byteLength > prior) { await reader.cancel(); controller.abort(); target.error(new Error("Metadata byte budget exceeded")); return; }
                        }
                        if (bytes > maxBytes) { await reader.cancel(); controller.abort(); target.error(new Error("Metadata byte budget exceeded")); return; }
                        target.enqueue(result.value);
                    },
                    cancel: reason => reader.cancel(reason),
                });
                return new Response(body, { status: response.status, headers: response.headers });
            }) as typeof fetch,
        }) });
        const [video, primaryAudio, audio, format] = await Promise.all([
            input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack(), input.getAudioTracks(), input.getFormat(),
        ]);
        const describe = async (track: InputTrack): Promise<StreamTrackMetadata> => {
            const raw = await track.getInternalCodecId();
            return { language: await track.getLanguageCode?.() || undefined, codec: await track.getCodec(), codecString: await track.getCodecParameterString().catch(() => null),
                internalCodecId: typeof raw === "string" || typeof raw === "number" ? String(raw) : null };
        };
        return { mimeType: format.mimeType, video: video ? await describe(video) : null,
            audio: await Promise.all(audio.map(async track => ({ ...await describe(track), primary: track.id === primaryAudio?.id, channels: await track.getNumberOfChannels() }))) };
    })().catch(() => undefined);
    try { return await Promise.race([operation, aborted]); }
    finally { clearTimeout(timer); controller.abort(); signal.removeEventListener("abort", onAbort); input?.dispose(); }
}
