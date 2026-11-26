import { parseStreamResponse } from "./stream-schema";
import type { StremioStream } from "@/types/stremio";

export type StreamAddonTarget = { id: string; name?: string; transportUrl?: string };
const cooldowns = new Map<string, number>();

function rateLimited(key: string, response: Response): never {
    const retry = response.headers.get("Retry-After");
    const seconds = retry?.trim() ? Number(retry) : NaN;
    const until = Number.isFinite(seconds) && seconds >= 0 ? Date.now() + seconds * 1000 : Date.parse(retry || "");
    for (const [id, expires] of cooldowns) if (expires <= Date.now()) cooldowns.delete(id);
    if (cooldowns.size >= 128) cooldowns.delete(cooldowns.keys().next().value!);
    cooldowns.set(key, Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60_000);
    void response.body?.cancel();
    throw new Error("This add-on is rate limited. Wait before trying again.");
}

/** Browser-compatible providers use the viewer's connection. Only transport
 * failures and header-dependent access failures use the authenticated backend. */
export async function fetchAddonStreams(
    addon: StreamAddonTarget, id: string, type: string, signal: AbortSignal, fetchFn: typeof fetch = fetch,
): Promise<StremioStream[]> {
    signal.throwIfAborted();
    const key = addon.transportUrl || addon.id;
    if ((cooldowns.get(key) || 0) > Date.now()) throw new Error("This add-on is rate limited. Wait before trying again.");
    let direct: URL | undefined;
    if (addon.transportUrl) {
        try {
            const url = new URL(addon.transportUrl);
            if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && /\/manifest\.json$/.test(url.pathname)) {
                url.pathname = url.pathname.replace(/\/manifest\.json$/, "") + `/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
                url.hash = "";
                direct = url;
            }
        } catch { /* Older or unsupported targets keep the backend path. */ }
    }
    let response: Response | undefined;
    if (direct) {
        try {
            response = await fetchFn(direct.href, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
                mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
            });
        } catch {
            // CORS, mixed-content and network failures are opaque to browser JS.
            // A consumer cancellation must never start another request.
            signal.throwIfAborted();
        }
        if (response?.status === 429) rateLimited(key, response);
        if (response && [401, 403, 405].includes(response.status)) {
            await response.body?.cancel();
            response = undefined;
        }
    }
    if (!response) {
        signal.throwIfAborted();
        response = await fetchFn("/api/streams/addon?" + new URLSearchParams({ mediaItemId: id, type, addonId: addon.id }), {
            signal, credentials: "same-origin", cache: "no-store",
        });
    }
    if (response.status === 429) rateLimited(key, response);
    if (!response.ok) {
        void response.body?.cancel();
        throw new Error("Could not load streams from this add-on.");
    }
    const streams = parseStreamResponse(await response.json());
    return streams.map(stream => ({ ...stream, name: stream.name || addon.name || "Unknown source" }));
}
