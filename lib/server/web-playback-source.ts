import "server-only";
import { outboundFetch, outboundUrl } from "./outbound-fetch";

/** Resolve redirects before browser fetch reaches a non-CORS addon response.
 * Only a one-byte range is requested. Video continues directly from the CDN. */
export async function resolveWebPlaybackSource(url: string, signal: AbortSignal): Promise<string> {
    let resolved = outboundUrl(url).href;
    const response = await outboundFetch(resolved, {
        signal, headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" },
    }, {
        timeoutMs: 10_000,
        // Servers can ignore Range. Cancel the body below, without downloading it.
        maxBytes: Number.MAX_SAFE_INTEGER,
        onFinalUrl: final => { resolved = final.href; },
    });
    try {
        if (!response.ok) throw new Error("Playback source unavailable");
        const type = response.headers.get("Content-Type") || "";
        if (/^(text\/|application\/(json|problem\+json))/i.test(type)) throw new Error("Playback source is not media");
        signal.throwIfAborted();
        return resolved;
    } finally { await response.body?.cancel(); }
}
