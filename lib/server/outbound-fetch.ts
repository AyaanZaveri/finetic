import "server-only";
import ipaddr from "ipaddr.js";
import type { LookupFunction } from "node:net";
import type { Agent } from "undici";

export class OutboundRequestError extends Error {}
type Policy = { provider?: boolean; maxBytes?: number; timeoutMs?: number; onFinalUrl?: (_url: URL) => void };
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;
type FetchInput = Parameters<typeof fetch>[0];
const DEFAULT_LIMIT = 8 * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const agents = new Map<boolean, Promise<Agent>>();

export function localProvidersAllowed(): boolean {
    return process.env.NODE_ENV === "development"
        || (process.env.NAVIGATOR_DESKTOP === "1" && process.env.HOSTNAME === "127.0.0.1");
}

export function addressAllowed(address: string, loopback = false): boolean {
    try {
        const parsed = ipaddr.process(address);
        const range = parsed.range();
        return range === "unicast" || (loopback && range === "loopback");
    } catch { return false; }
}

export function outboundUrl(input: string | URL, policy: Policy = {}): URL {
    let url: URL;
    try { url = new URL(String(input)); } catch { throw new OutboundRequestError("Enter a valid HTTP or HTTPS URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 8192) {
        throw new OutboundRequestError("Enter an HTTP or HTTPS URL without embedded credentials.");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    const loopback = !!policy.provider && localProvidersAllowed();
    if (ipaddr.isValid(hostname)) {
        if (!addressAllowed(hostname, loopback)) throw new OutboundRequestError("Private and reserved network destinations are not allowed.");
    } else if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        if (!loopback) throw new OutboundRequestError("Local providers are available only in development or the desktop app.");
    } else if (!hostname.includes(".") || /\.(local|internal|home|lan|test|invalid)$/.test(hostname)) {
        throw new OutboundRequestError("Use a public hostname for this connection.");
    }
    url.hash = "";
    return url;
}

/** The same lookup that selects the connected IP validates every returned address: no DNS preflight race. */
export const guardedLookup = (loopback: boolean): LookupFunction => (hostname, options, callback) => {
    void import("node:dns").then(({ lookup }) => lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        if (!addresses.length || addresses.some(item => !addressAllowed(item.address, loopback))) {
            return callback(new OutboundRequestError("The destination resolves to a private or reserved network."), "", 4);
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
    })).catch(error => callback(error, "", 4));
};

function agent(loopback: boolean): Promise<Agent> {
    let value = agents.get(loopback);
    if (!value) {
        value = import("undici").then(({ Agent }) => new Agent({
            connect: { lookup: guardedLookup(loopback), timeout: 10_000 },
            connections: 4, maxOrigins: 128, headersTimeout: 15_000, bodyTimeout: 30_000,
        }));
        agents.set(loopback, value);
    }
    return value;
}

function cloudflareRuntime(): boolean {
    return "WebSocketPair" in globalThis;
}

function boundedResponse(response: Response, limit: number): Response {
    if (Number(response.headers.get("Content-Length")) > limit) {
        void response.body?.cancel();
        throw new OutboundRequestError("The upstream response is too large.");
    }
    if (!response.body) return response;
    let bytes = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > limit) throw new OutboundRequestError("The upstream response is too large.");
            controller.enqueue(chunk);
        },
    }));
    // fetch has already decoded transport encodings; do not propagate stale length/encoding headers.
    const headers = new Headers(response.headers);
    headers.delete("Content-Length"); headers.delete("Content-Encoding");
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export async function outboundFetch(input: string | URL, init: FetchOptions = {}, policy: Policy = {}): Promise<Response> {
    let url = outboundUrl(input, policy);
    const timeout = AbortSignal.timeout(policy.timeoutMs ?? 15_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let headers = new Headers(init.headers);
    const loopback = !!policy.provider && localProvidersAllowed();
    for (let hop = 0; hop <= 4; hop++) {
        signal.throwIfAborted();
        // Hosted workerd's public network filters the connected addresses, including DNS
        // results. Keep arbitrary public addon/CDN hosts usable without a domain registry.
        // Node does the equivalent inside its connection lookup below.
        // Next's cache tees upstream bodies before callers read them. Untrusted responses must
        // not keep draining through that independent clone after a byte-limit rejection.
        const options = { ...init, cache: "no-store" as const, next: { ...init.next, revalidate: 0 }, headers, signal, redirect: "manual" as const,
            ...(!cloudflareRuntime() ? { dispatcher: await agent(loopback) } : {}) };
        const response = await fetch(url, options);
        if (!REDIRECTS.has(response.status)) {
            policy.onFinalUrl?.(url);
            return boundedResponse(response, policy.maxBytes ?? DEFAULT_LIMIT);
        }
        await response.body?.cancel();
        if (init.redirect === "error" || policy.provider || hop === 4 || !["GET", "HEAD"].includes((init.method || "GET").toUpperCase())) {
            throw new OutboundRequestError("The upstream redirect was refused.");
        }
        const location = response.headers.get("Location");
        if (!location) throw new OutboundRequestError("The upstream redirect has no destination.");
        const next = outboundUrl(new URL(location, url), policy);
        if (url.protocol === "https:" && next.protocol !== "https:") throw new OutboundRequestError("An insecure redirect was refused.");
        if (next.origin !== url.origin) {
            headers = new Headers(headers);
            for (const name of ["Authorization", "Cookie", "Proxy-Authorization"]) headers.delete(name);
        }
        url = next;
    }
    throw new OutboundRequestError("Too many upstream redirects.");
}

/** AI SDK accepts fetch overrides; providers may send Request instances as well as URLs. */
export const providerFetch = Object.assign(async (input: FetchInput, init?: FetchOptions): Promise<Response> => {
    if (input instanceof Request) {
        return outboundFetch(input.url, { method: input.method, headers: input.headers, signal: input.signal,
            ...(input.body ? { body: await input.arrayBuffer() } : {}), ...init }, { provider: true, timeoutMs: 120_000 });
    }
    return outboundFetch(String(input), init, { provider: true, timeoutMs: 120_000 });
}, { preconnect: () => undefined });
