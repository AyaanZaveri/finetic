import { parseStreamResponse } from "./stream-schema";
import type { StremioStream } from "@/types/stremio";

export type StreamAddonTarget = { id: string; name?: string; transportUrl?: string };
const cooldowns = new Map<string, number>();
const failureMessages = {
    rateLimited: "An add-on is rate limited. Wait before trying again.",
    connection: "Your browser could not connect to an add-on. Check your connection or the add-on's browser access settings.",
    rejected: "An add-on rejected the request. Check your access with the provider.",
    unavailable: "Could not load streams from your add-ons. Try again.",
} as const;
type FailureKind = keyof typeof failureMessages;
class AddonStreamError extends Error {
    constructor(readonly kind: FailureKind) {
        super(failureMessages[kind]);
        this.name = "AddonStreamError";
    }
}

export function summarizeAddonFailures(errors: unknown[]): Error {
    for (const kind of ["rateLimited", "rejected", "connection"] as const) {
        if (errors.some(error => error instanceof AddonStreamError && error.kind === kind)) return new AddonStreamError(kind);
    }
    return new AddonStreamError("unavailable");
}

// Only show our fixed, credential-free messages, never raw provider errors.
export function getAddonStreamErrorMessage(error: unknown): string {
    if (error instanceof AddonStreamError) return failureMessages[error.kind];
    return failureMessages.unavailable;
}

function rateLimited(key: string, response: Response): never {
    const retry = response.headers.get("Retry-After");
    const seconds = retry?.trim() ? Number(retry) : NaN;
    const until = Number.isFinite(seconds) && seconds >= 0 ? Date.now() + seconds * 1000 : Date.parse(retry || "");
    for (const [id, expires] of cooldowns) if (expires <= Date.now()) cooldowns.delete(id);
    if (cooldowns.size >= 128) cooldowns.delete(cooldowns.keys().next().value!);
    cooldowns.set(key, Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60_000);
    void response.body?.cancel();
    throw new AddonStreamError("rateLimited");
}

/** Use the provider's normal HTTP cache rules. A failed direct request must
 * not be repeated from the server: CORS can hide a provider's rejection or 429. */
export async function fetchAddonStreams(
    addon: StreamAddonTarget, id: string, type: string, signal: AbortSignal, fetchFn: typeof fetch = fetch,
): Promise<StremioStream[]> {
    signal.throwIfAborted();
    const key = addon.transportUrl || addon.id;
    if ((cooldowns.get(key) || 0) > Date.now()) throw new AddonStreamError("rateLimited");
    let direct: URL | undefined;
    if (addon.transportUrl) {
        try {
            const url = new URL(addon.transportUrl);
            if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && /\/manifest\.json$/.test(url.pathname)) {
                url.pathname = url.pathname.replace(/\/manifest\.json$/, "") + `/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
                url.hash = "";
                direct = url;
            }
        } catch { /* Invalid configured URLs cannot be used. */ }
        if (!direct) throw new AddonStreamError("rejected");
    }
    let response: Response;
    if (direct) {
        try {
            response = await fetchFn(direct.href, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
                mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "default",
            });
        } catch {
            // CORS, mixed-content and network failures are opaque to browser JS.
            signal.throwIfAborted();
            throw new AddonStreamError("connection");
        }
    } else {
        // Compatibility for older listings that do not include transport URLs.
        signal.throwIfAborted();
        response = await fetchFn("/api/streams/addon?" + new URLSearchParams({ mediaItemId: id, type, addonId: addon.id }), {
            signal, credentials: "same-origin", cache: "no-store",
        });
    }
    if (response.status === 429) rateLimited(key, response);
    if (!response.ok) {
        void response.body?.cancel();
        throw new AddonStreamError([401, 403].includes(response.status) ? "rejected" : "unavailable");
    }
    const streams = parseStreamResponse(await response.json());
    return streams.map(stream => ({ ...stream, name: stream.name || addon.name || "Unknown source" }));
}
