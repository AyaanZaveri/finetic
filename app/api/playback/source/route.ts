import { getAuthData } from "@/lib/server/auth";
import { resolveWebPlaybackSource } from "@/lib/server/web-playback-source";

export const runtime = "nodejs";
const MAX_BODY = 16 * 1024;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** URLs stay in an authenticated POST body, outside request paths and logs. */
export async function POST(request: Request) {
    // Next's standalone server can canonicalize request.url to localhost.
    // Compare against the incoming Host so 127.0.0.1 and deployed domains work.
    const requestUrl = new URL(request.url);
    const host = request.headers.get("Host") || requestUrl.host;
    if (request.headers.get("Origin") !== `${requestUrl.protocol}//${host}`) return reply({ error: "Invalid origin" }, 403);
    try { await getAuthData(); } catch { return reply({ error: "Unauthorized" }, 401); }
    if (Number(request.headers.get("Content-Length")) > MAX_BODY) return reply({ error: "Request too large" }, 413);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Missing source" }, 400);
    let body: unknown;
    try {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_BODY) { await reader.cancel(); return reply({ error: "Request too large" }, 413); }
            chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        body = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return reply({ error: "Invalid source" }, 400); }
    const url = (body as { url?: unknown } | null)?.url;
    if (typeof url !== "string" || !url || url.length > 8192) return reply({ error: "Invalid source" }, 400);
    try {
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
        return reply({ url: await resolveWebPlaybackSource(url, signal) });
    } catch { return reply({ error: "Playback source unavailable" }, 502); }
}
