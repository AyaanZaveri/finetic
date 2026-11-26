import "server-only";
import { outboundFetch, outboundUrl } from "./outbound-fetch";
import { mediaFlowBaseUrl, mediaFlowRequest, mediaFlowResponse } from "../media/mediaflow-url";

/** Resolve redirects before browser fetch reaches a non-CORS addon response.
 * Only a one-byte range is requested. Video continues directly from the CDN. */
export async function resolveWebPlaybackSource(url: string, signal: AbortSignal): Promise<string> {
    return (await inspectWebPlaybackSource(url, signal)).url;
}

async function inspectWebPlaybackSource(url: string, signal: AbortSignal): Promise<{ url: string; hls: boolean }> {
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
        const hls = /(?:mpegurl)/i.test(type) || /\.m3u8$/i.test(new URL(resolved).pathname);
        if (/^(text\/|application\/(json|problem\+json))/i.test(type)
            && !(hls && /^(text\/plain|[^;]*mpegurl)/i.test(type))) throw new Error("Playback source is not media");
        signal.throwIfAborted();
        return { url: resolved, hls };
    } finally { await response.body?.cancel(); }
}

/** The hosted proxy receives only the validated media destination. The API
 * password stays on the server; the player receives a scoped playback URL. */
export async function resolveInHouseMediaFlowSource(url: string, signal: AbortSignal): Promise<string> {
    const base = mediaFlowBaseUrl(process.env.MEDIAFLOW_PROXY_URL || "");
    const password = process.env.MEDIAFLOW_API_PASSWORD;
    if (!base || !password) throw new Error("In-house MediaFlow is not configured");
    const destination = await inspectWebPlaybackSource(url, signal);
    const response = await outboundFetch(new URL("generate_url", base), {
        method: "POST", redirect: "error", signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mediaFlowRequest(base, destination.url, password, destination.hls)),
    }, { maxBytes: 64 * 1024, timeoutMs: 10_000 });
    if (!response.ok) { await response.body?.cancel(); throw new Error("MediaFlow is unavailable"); }
    const generated = mediaFlowResponse(base, await response.json());
    // The generator must return a scoped token, not a URL containing the
    // reusable in-house password.
    if (!/\/_token_[^/]+\/proxy\//.test(new URL(generated).pathname)) throw new Error("MediaFlow did not generate a protected playback URL");
    return generated;
}
