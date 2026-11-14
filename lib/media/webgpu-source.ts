const sources = new Map<string, { url: string; expires: number }>();

/** Cache successful resolutions briefly for the probe, player, and audio retry.
 * Never persist signed media URLs or put them in browser request paths. */
export async function resolveWebGpuSource(url: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    for (const [key, source] of sources) if (source.expires <= Date.now()) sources.delete(key);
    const cached = sources.get(url);
    if (cached) return cached.url;
    try {
        const response = await fetch("/api/playback/source", { method: "POST", signal,
            credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
        if (!response.ok) return url;
        const result: { url?: unknown } = await response.json();
        if (typeof result.url !== "string" || result.url.length > 8192) return url;
        const resolved = new URL(result.url);
        if (!/^https?:$/.test(resolved.protocol) || resolved.username || resolved.password) return url;
        signal.throwIfAborted();
        sources.set(url, { url: resolved.href, expires: Date.now() + 60_000 });
        if (sources.size > 32) sources.delete(sources.keys().next().value!);
        return resolved.href;
    } catch {
        signal.throwIfAborted();
        // A server without this endpoint can still play CORS-readable sources.
        return url;
    }
}
