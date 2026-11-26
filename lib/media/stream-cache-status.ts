import type { StremioStream } from "@/types/stremio";

export type StreamCacheStatus = "cached" | "uncached" | "unknown";

const service = "(?:RD|AD|PM|TB|DL|ED|DEBRID-LINK|REAL-DEBRID|ALLDEBRID|PREMIUMIZE|TORBOX)";
const uncachedService = new RegExp("\\[\\s*" + service + "\\s*(?:-|download)\\s*\\]", "i");
const cachedService = new RegExp("\\[\\s*" + service + "\\s*\\+\\s*\\]", "i");

// Cache status is add-on metadata, not a property of a playable HTTP URL.
// Do not infer it from release filenames, quality, codecs or URL paths.
export function getStreamCacheStatus(stream: StremioStream): StreamCacheStatus {
    const metadata = stream as StremioStream & { cached?: unknown; isCached?: unknown };
    const hints = stream.behaviorHints as (StremioStream["behaviorHints"] & { cached?: unknown; isCached?: unknown }) | undefined;
    const flags = [metadata.cached, metadata.isCached, hints?.cached, hints?.isCached];
    const label = [stream.name, stream.title, stream.description].filter(Boolean).join("\n")
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
    // Explicit negatives win over decorative or conflicting positive labels.
    if (flags.includes(false) || /\b(?:un[- ]?cached|not\s+(?:yet\s+)?cached|cache\s+miss)\b/i.test(label)
        || uncachedService.test(label) || /[🧲⏳]/u.test(label)) return "uncached";
    if (flags.includes(true) || /\b(?:cached|cache\s+hit)\b/i.test(label)
        || cachedService.test(label) || label.includes("⚡")) return "cached";
    return "unknown";
}

export function compareStreamCacheStatus(a: StremioStream, b: StremioStream): number {
    return Number(getStreamCacheStatus(b) === "cached") - Number(getStreamCacheStatus(a) === "cached");
}
