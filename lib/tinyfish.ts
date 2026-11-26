import "server-only";
import { z } from "zod";

const searchSchema = z.object({ results: z.array(z.object({
    title: z.string(), snippet: z.string().optional(), url: z.string().url(), position: z.number().optional(), site_name: z.string().optional(),
})) });
const fetchSchema = z.object({
    results: z.array(z.object({ url: z.string(), final_url: z.string().nullish(), title: z.string().nullish(), text: z.string().nullable() })),
    errors: z.array(z.object({ url: z.string(), error: z.unknown(), status: z.number().optional() })).default([]),
});

export interface WebEvidence { id: string; title: string; url: string; text: string }
export type TinySearchResult = Awaited<ReturnType<typeof searchTinyfish>>[number];
export type EpisodeSourceRanking = (results: TinySearchResult[]) => Promise<TinySearchResult[]>;

function publicUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password
            && !/^(localhost|.*\.local|.*\.localhost|[\d.]+|\[.*\])$/i.test(url.hostname);
    } catch { return false; }
}

async function request(url: string, apiKey: string, signal: AbortSignal | undefined, body?: unknown) {
    const timeout = AbortSignal.timeout(body ? 20_000 : 10_000);
    try {
        const response = await fetch(url, {
            method: body ? "POST" : "GET",
            headers: { "X-API-Key": apiKey, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
            cache: "no-store", redirect: "manual", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (response.status === 401 || response.status === 403) throw new Error("TinyFish rejected the API key or access. Check TinyFish in Settings.");
        if (response.status === 402 || response.status === 429) throw new Error("TinyFish has reached its usage allowance. Try again later or check your TinyFish account.");
        if (!response.ok) throw new Error("TinyFish web search is unavailable. Try again shortly.");
        return await response.json();
    } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && error.message.startsWith("TinyFish")) throw error;
        throw new Error("Could not reach TinyFish. Check your connection and try again.");
    }
}

export async function searchTinyfish(query: string, purpose: string, apiKey: string, signal?: AbortSignal) {
    const url = new URL("https://api.search.tinyfish.ai/");
    url.searchParams.set("query", query);
    url.searchParams.set("purpose", purpose);
    return searchSchema.parse(await request(url.toString(), apiKey, signal)).results.filter(item => publicUrl(item.url));
}

/** Score overlapping passages instead of cutting a page at the start. Keep text verbatim for evidence checks. */
export function webPassages(text: string, query: string): string {
    if (text.length <= 10_000) return text;
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])]
        .filter(term => !/^(the|for|you|where|episode|season|show|which|that|with|from|goes|about)$/.test(term));
    const lower = text.toLowerCase();
    const weights = terms.map(term => ({ term, weight: 1 / Math.max(1, lower.split(term).length - 1) }));
    const chunks = Array.from({ length: Math.ceil(text.length / 1200) }, (_, index) => {
        const start = Math.max(0, index * 1200 - 300);
        const passage = text.slice(start, start + 1800);
        return { start, passage, score: weights.reduce((sum, { term, weight }) => sum + (passage.toLowerCase().includes(term) ? weight : 0), 0) };
    });
    return [text.slice(0, 800), ...chunks.sort((a, b) => b.score - a.score).slice(0, 5)
        .sort((a, b) => a.start - b.start).map(chunk => chunk.passage)].join("\n\n[…]\n\n");
}

/** Rank the actual clue, rather than promoting generic encyclopedias over dialogue/scene sources. */
export function rankMediaSources<T extends { title: string; snippet?: string; url: string }>(results: T[], query: string): T[] {
    const tokens = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
    const terms = [...tokens(query)].filter(term => !/^(the|where|when|she|they|says|said|episode|show|scene|from|with|that|this|goes|into|what|which)$/.test(term));
    const titlePhrase = /["“]([^"”]+)["”]/.exec(query)?.[1].toLowerCase();
    const documents = results.map(item => tokens(`${item.title} ${item.snippet || ""}`));
    const weights = terms.map(term => ({ term, weight: Math.log(1 + results.length / (1 + documents.filter(doc => doc.has(term)).length)) }));
    return results.map((item, index) => {
        const title = tokens(item.title);
        const identity = titlePhrase ? item.title.toLowerCase().includes(titlePhrase) ? 4 : item.snippet?.toLowerCase().includes(titlePhrase) ? 2 : 0 : 0;
        const relevance = weights.reduce((sum, { term, weight }) => sum + (title.has(term) ? 2 : documents[index].has(term) ? 1 : 0) * weight, 0);
        return { item, score: identity + relevance / Math.sqrt(1 + (item.snippet?.length || 0) / 1000) - index * 0.05 };
    }).sort((a, b) => b.score - a.score).map(({ item }) => item);
}

/** Search titles are discovery leads, not evidence. Promote pages that name
 * an actual catalog episode; retain the original relevance order otherwise. */
export function rankEpisodeSources(results: TinySearchResult[], episodeTitles: string[]): TinySearchResult[] {
    const normalized = (value: string) => ` ${value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
    const titles = [...new Set(episodeTitles.map(normalized))].filter(title => title.trim().length >= 4);
    const ranked = results.map((result, index) => {
        const heading = normalized(result.title);
        const snippet = normalized(result.snippet ?? "");
        const named = titles.filter(title => heading.includes(title));
        // A page listing many episodes is less useful than a focused hit.
        const score = named.length === 1 ? 2 : named.length === 0 && titles.some(title => snippet.includes(title)) ? 1 : 0;
        return { result, index, score: score - index * 0.3 };
    }).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.result);
    // Many hits can be different pages on the same site. A four-page budget
    // should not be spent on four copies of one source when alternatives exist.
    const seen = new Set<string>();
    const first: TinySearchResult[] = [], repeated: TinySearchResult[] = [];
    for (const result of ranked) {
        const host = new URL(result.url).hostname.replace(/^www\./, "");
        (seen.has(host) ? repeated : first).push(result);
        seen.add(host);
    }
    return [...first, ...repeated];
}

export async function fetchMediaWebSources(urls: string[], purpose: string, apiKey: string, signal?: AbortSignal, query = purpose): Promise<WebEvidence[]> {
    if (!urls.length || urls.length > 10 || urls.some(url => !publicUrl(url))) throw new Error("Provide up to ten public HTTPS source URLs.");
    const data = fetchSchema.parse(await request("https://api.fetch.tinyfish.ai/", apiKey, signal, {
        urls, purpose, format: "markdown", per_url_timeout_ms: 10_000,
    }));
    const sources = data.results.filter(item => urls.includes(item.url) && publicUrl(item.final_url || item.url)
        && typeof item.text === "string" && item.text.trim() && !/\b(sign in|log in|captcha|access denied|site maintenance)\b/i.test(item.title || ""))
        .map((item, index) => ({ id: `web:${index + 1}`, url: item.final_url || item.url,
            title: item.title || new URL(item.url).hostname, text: webPassages(item.text!, query) }));
    if (!sources.length && data.errors.length) throw new Error("TinyFish could not read the matching sources. Try another description.");
    return sources;
}

/**
 * Automatic episode research can verify a small set of completed pages while
 * slower URLs load. Use individual requests so TinyFetch's batch tail latency
 * does not block available evidence. Never use search snippets as page proof.
 * Yield cumulative evidence with stable IDs; closing the iterator aborts
 * outstanding reads.
 */
export async function* streamMediaWebEvidence(query: string, purpose: string, apiKey: string, signal?: AbortSignal,
    onSearchResults?: (_results: TinySearchResult[]) => void, rankEpisodes?: EpisodeSourceRanking): AsyncGenerator<WebEvidence[]> {
    const results = await searchTinyfish(query, purpose, apiKey, signal);
    onSearchResults?.(results);
    const ranked = rankMediaSources(results, query);
    const candidates = rankEpisodes ? await rankEpisodes(ranked) : ranked;
    signal?.throwIfAborted();
    const urls = [...new Set(candidates.map(item => item.url))].slice(0, 4);
    if (!urls.length) { yield []; return; }
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const pending = new Map(urls.map((url, index) => [index,
        fetchMediaWebSources([url], purpose, apiKey, combined, query)
            .then(sources => ({ index, sources, error: undefined }), error => ({ index, sources: [] as WebEvidence[], error }))]));
    const collected: WebEvidence[] = [];
    let lastYield = 0;
    let firstError: unknown;
    try {
        while (pending.size) {
            combined.throwIfAborted();
            const settled = await Promise.race(pending.values());
            pending.delete(settled.index);
            combined.throwIfAborted();
            firstError ??= settled.error;
            for (const source of settled.sources) {
                if (!collected.some(item => item.url === source.url)) collected.push({ ...source, id: `web:${settled.index + 1}` });
            }
            // Two readable sources are a useful first verification set. If
            // only one is available, it is still usable once the reads settle.
            if ((lastYield === 0 && collected.length >= 2) || (!pending.size && collected.length > lastYield)) {
                lastYield = collected.length;
                yield [...collected];
            }
        }
        if (!collected.length && firstError) throw firstError;
        if (!collected.length) yield [];
    } finally { controller.abort(); }
}

export async function researchMediaWeb(query: string, purpose: string, apiKey: string, signal?: AbortSignal,
    onSearchResults?: (_results: Awaited<ReturnType<typeof searchTinyfish>>) => void): Promise<WebEvidence[]> {
    const results = await searchTinyfish(query, purpose, apiKey, signal);
    onSearchResults?.(results);
    const urls = [...new Set(rankMediaSources(results, query).map(item => item.url))].slice(0, 4);
    return urls.length ? fetchMediaWebSources(urls, purpose, apiKey, signal, query) : [];
}
