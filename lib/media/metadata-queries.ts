import { notifyManager, QueryObserver, queryOptions, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";
import type { StreamQueries } from "./stream-queries";
import type { MediaToPlay } from "@/lib/atoms";
import { METADATA_DEFAULTS, metadataTarget, metadataKey, titleEnvelopeSchema, episodeEnvelopeSchema,
    metadataDetails, metadataEpisode, enrichPlayback, type TitleEnvelope, type EpisodeEnvelope, type MetadataEnvelope } from "./metadata";

type Purpose = "required" | "speculative";
type Owners = { required: number; speculative: number; stop: () => void };
export function createMetadataQueries(streams: StreamQueries, fetchFn: typeof fetch = fetch) {
    const { client, scope } = streams;
    const root = ["metadata", scope];
    const owners = new Map<string, Owners>();
    const used = new Map<string, number>();
    let disposed = false;
    const read = async (url: string, signal: AbortSignal) => {
        const response = await fetchFn(url, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Title details could not be loaded.");
        return response.json();
    };
    const configOptions = queryOptions({ ...METADATA_DEFAULTS, staleTime: 30_000, gcTime: 60_000,
        queryKey: [...root, "config"], queryFn: async ({ signal }) => z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await read("/api/playback/metadata/config", signal)) });
    const fresh = (key: QueryKey, age: number = METADATA_DEFAULTS.staleTime) => {
        const state = client.getQueryState(key);
        return state?.status === "success" && !state.isInvalidated && Date.now() - state.dataUpdatedAt < age;
    };
    const prune = () => {
        const all = client.getQueryCache().findAll({ queryKey: root }).filter(q => ["title", "episode"].includes(String(q.queryKey[3]))
            && !q.getObserversCount() && q.state.fetchStatus !== "fetching");
        const order = all.sort((a, b) => (used.get(a.queryHash) ?? a.state.dataUpdatedAt) - (used.get(b.queryHash) ?? b.state.dataUpdatedAt));
        let bytes = all.reduce((sum, q) => sum + new TextEncoder().encode(JSON.stringify(q.state.data) || "").byteLength, 0);
        let titles = all.filter(q => q.queryKey[3] === "title").length, episodes = all.length - titles;
        for (const q of order) {
            const isTitle = q.queryKey[3] === "title";
            if (q.state.status === "error" || bytes > 8 * 1024 * 1024 || (isTitle ? titles > 64 : episodes > 128)) {
                bytes -= new TextEncoder().encode(JSON.stringify(q.state.data) || "").byteLength;
                if (isTitle) titles--; else episodes--;
                client.removeQueries({ queryKey: q.queryKey, exact: true }); used.delete(q.queryHash);
            }
        }
        const aliases = client.getQueryCache().findAll({ queryKey: [...root, "identity"] }).filter(q => !q.getObserversCount()).sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
        for (const query of aliases.slice(0, Math.max(0, aliases.length - 128))) client.removeQueries({ queryKey: query.queryKey, exact: true });
        const live = new Set(client.getQueryCache().findAll({ queryKey: root }).map(q => q.queryHash));
        for (const hash of used.keys()) if (!live.has(hash)) used.delete(hash);
    };
    const options = (revision: string, type: string, id: string, season?: number, episode?: number, requestId = id) => queryOptions({
        ...METADATA_DEFAULTS, queryKey: metadataKey(scope, revision, type, id, season, episode),
        queryFn: async ({ signal }): Promise<MetadataEnvelope> => {
            const params = new URLSearchParams({ id: requestId, type, metadata: "1", revision });
            if (season !== undefined && episode !== undefined) { params.set("season", String(season)); params.set("episode", String(episode)); }
            const response = await read(`/api/playback/${season === undefined ? "details" : "episode"}?${params}`, signal);
            const record = season === undefined ? titleEnvelopeSchema.parse(response.metadata) : episodeEnvelopeSchema.parse(response.metadata);
            if (record.coverage !== "header") throw new Error("Incomplete metadata response.");
            if ("seriesId" in record.data && (record.data.seriesId !== id || record.data.season !== season || record.data.episode !== episode)) {
                throw new Error("Episode metadata does not match the requested episode.");
            }
            // Requests may be answered by an older server success. Its timestamp,
            // rather than a navigation/read, controls freshness in both caches.
            return record;
        },
        structuralSharing: (old: unknown, incoming: unknown) => mergeMetadata(old as MetadataEnvelope | undefined, incoming as MetadataEnvelope),
    });
    const obtain = async (media: MediaToPlay, episode: boolean, purpose: Purpose, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        const target = metadataTarget(media);
        const [id, config] = await Promise.all([streams.resolveIdentity(target.id, target.type), client.query(configOptions)]);
        signal?.throwIfAborted();
        if (disposed) throw new Error("Metadata session ended.");
        // Share canonical client records, but warm title details under the
        // original route ID so the server page can reuse that exact read.
        const opts = options(config.revision, target.type, id, episode ? target.season : undefined, episode ? target.episode : undefined, episode ? id : target.id);
        const hash = JSON.stringify(opts.queryKey);
        let owner = owners.get(hash);
        if (!owner) {
            const observer = new QueryObserver(client, { ...opts, enabled: false });
            const stop = observer.subscribe(() => {});
            owner = { required: 0, speculative: 0, stop }; owners.set(hash, owner);
        }
        owner[purpose]++;
        const current = owner;
        let released = false;
        const release = () => { if (released) return; released = true; current[purpose]--; };
        signal?.addEventListener("abort", release, { once: true });
        const operation = client.query(opts);
        // Keep an observer through completion, including teardown/quick Play.
        // Caller cancellation releases only its own interest.
        try {
            const record = await operation;
            signal?.throwIfAborted();
            if (!disposed) {
                const merged = mergeMetadata(client.getQueryData<MetadataEnvelope>(opts.queryKey), record);
                client.setQueryData(opts.queryKey, merged, { updatedAt: merged.fetchedAt });
            }
            const query = client.getQueryCache().find({ queryKey: opts.queryKey, exact: true });
            if (query) used.set(query.queryHash, Date.now());
            return record;
        } finally {
            signal?.removeEventListener("abort", release); release();
            if (!current.required && !current.speculative) { current.stop(); owners.delete(hash); prune(); }
        }
    };
    const peek = (media: MediaToPlay) => {
        // Configuration gets rechecked on demand. A merely old check does not
        // erase valid 15-minute metadata before that check discovers a change.
        const configuration = client.getQueryState(configOptions.queryKey);
        if (!configuration?.data || configuration.isInvalidated) return {};
        const config = client.getQueryData(configOptions.queryKey)!;
        const target = metadataTarget(media), id = streams.peekIdentity(target.id, target.type);
        if (!id) return {};
        const titleKey = metadataKey(scope, config.revision, target.type, id);
        const episodeKey = metadataKey(scope, config.revision, target.type, id, target.season, target.episode);
        return { title: fresh(titleKey) ? client.getQueryData<TitleEnvelope>(titleKey) : undefined,
            episode: target.season !== undefined && fresh(episodeKey) ? client.getQueryData<EpisodeEnvelope>(episodeKey) : undefined };
    };
    const title = (media: MediaToPlay, purpose: Purpose = "required", signal?: AbortSignal) => obtain(media, false, purpose, signal) as Promise<TitleEnvelope>;
    const episode = (media: MediaToPlay, purpose: Purpose = "required", signal?: AbortSignal) => obtain(media, true, purpose, signal) as Promise<EpisodeEnvelope>;
    return { client, scope, options, configOptions, title, episode, peek, prune,
        observe(media: MediaToPlay, notify: () => void) {
            const held = new Map<string, () => void>();
            let attaching = false, active = true;
            // Hydration can write the cache during a different component's render.
            // Match useQuery's scheduled external-store notifications.
            const publish = notifyManager.batchCalls(() => { if (active) notify(); });
            const attach = () => {
                if (attaching) return;
                attaching = true;
                try {
                    const target = metadataTarget(media), config = client.getQueryData(configOptions.queryKey);
                    const id = streams.peekIdentity(target.id, target.type);
                    if (!config || !id) return;
                    const records = [options(config.revision, target.type, id), ...(target.season !== undefined && target.episode !== undefined
                        ? [options(config.revision, target.type, id, target.season, target.episode)] : [])];
                    const keys = new Set(records.map(record => JSON.stringify(record.queryKey)));
                    for (const [key, release] of held) if (!keys.has(key)) { release(); held.delete(key); }
                    for (const record of records) {
                        const key = JSON.stringify(record.queryKey);
                        if (!held.has(key)) {
                            const observer = new QueryObserver(client, { ...record, enabled: false });
                            held.set(key, observer.subscribe(publish));
                        }
                    }
                } finally { attaching = false; }
            };
            const unsubscribe = client.getQueryCache().subscribe(event => {
                if (event.query.queryKey[1] !== scope || attaching) return;
                attach(); publish();
            });
            attach();
            return () => { active = false; unsubscribe(); for (const release of held.values()) release(); held.clear(); prune(); };
        },
        enrich(media: MediaToPlay) { const cached = peek(media); return enrichPlayback(media, cached.title, cached.episode); },
        details: async (media: MediaToPlay, signal?: AbortSignal) => metadataDetails(await title(media, "required", signal)),
        episodeDetails: async (id: string, season: number, episodeNumber: number, signal?: AbortSignal) => metadataEpisode(await episode({ id, type: "series", name: "", seasonNumber: season, episodeNumber }, "required", signal)),
        async prepare(media: MediaToPlay, purpose: Purpose = "speculative", signal?: AbortSignal) {
            const target = metadataTarget(media);
            return Promise.allSettled([title(media, purpose, signal), ...(target.type === "series" && target.season !== undefined && target.episode !== undefined ? [episode(media, purpose, signal)] : [])]);
        },
        cancelSpeculation() {
            for (const [hash, owner] of owners) if (!owner.required) {
                void client.cancelQueries({ queryKey: JSON.parse(hash), exact: true });
            }
        },
        invalidate() { void client.invalidateQueries({ queryKey: root, refetchType: "none" }); },
        dispose() { disposed = true; for (const owner of owners.values()) owner.stop(); owners.clear(); },
    };
}
/** Omitted fields never erase known data; old previews cannot downgrade headers. */
export function mergeMetadata(previous: MetadataEnvelope | undefined, next: MetadataEnvelope): MetadataEnvelope {
    if (!previous) return next;
    if (previous.fetchedAt > next.fetchedAt || previous.coverage === "header" && next.coverage === "preview") return previous;
    const fields = Object.fromEntries(Object.entries(next.data).filter(([, v]) => v !== undefined && (!Array.isArray(v) || v.length)));
    const data = { ...previous.data, ...fields };
    if ("artwork" in previous.data && "artwork" in next.data) Object.assign(data, { artwork: { ...previous.data.artwork,
        ...Object.fromEntries(Object.entries(next.data.artwork).filter(([, v]) => v !== undefined)) } });
    data.ratings = [...new Map([...previous.data.ratings, ...next.data.ratings].map(rating => [`${rating.source}:${rating.scope}`, rating])).values()];
    const known = (field: string) => field.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, data);
    return { ...next, data, unavailable: next.unavailable.filter(field => { const value = known(field); return value === undefined || Array.isArray(value) && !value.length; }) } as MetadataEnvelope;
}
export type MetadataQueries = ReturnType<typeof createMetadataQueries>;
