import { QueryClient, QueryObserver, queryOptions, type QueryKey } from "@tanstack/react-query";
import { fetchPlaybackId } from "./fetch-playback-id";
import type { PlaybackStreamRequest, PlaybackStreamSnapshot, StreamWithAddon } from "./fetch-playback-streams";
import type { StremioStream } from "@/types/stremio";

type Target = { id: string; type: string };
type Purpose = "speculative" | "required";
type Addons = { revision: string; addons: { id: string; name: string }[] };
type Entry = {
    request: PlaybackStreamRequest; target: Target; generation: number; started: number;
    required: number; speculative: number; completed: boolean; dead: boolean;
    cleanups: (() => void)[]; keys: QueryKey[]; controller: AbortController;
};
export const STREAM_QUERY_DEFAULTS = {
    staleTime: 30_000, gcTime: 60_000, retry: false,
    refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
} as const;

/** One instance per mounted verified session. QueryClient owns response data;
 * entries own only progressive views, subscriptions, and consumer leases. */
export function createStreamQueries(scope: string, client = new QueryClient(), fetchFn: typeof fetch = fetch) {
    let generation = 0, disposed = false;
    const entries = new Set<Entry>();
    const aliases = new Map<string, Entry>();
    const lastUse = new Map<string, number>();
    const sizes = new WeakMap<object, { updatedAt: number; bytes: number }>();
    const payloadBytes = (query: { state: { data: unknown; dataUpdatedAt: number } }) => {
        const previous = sizes.get(query);
        if (previous?.updatedAt === query.state.dataUpdatedAt) return previous.bytes;
        const bytes = new TextEncoder().encode(JSON.stringify(query.state.data)).byteLength;
        sizes.set(query, { updatedAt: query.state.dataUpdatedAt, bytes });
        return bytes;
    };
    const root = ["playback", scope] as const;
    const identityOptions = (id: string, type: string) => queryOptions({ ...STREAM_QUERY_DEFAULTS, staleTime: 300_000, gcTime: 300_000,
        queryKey: [...root, "id", type, id.replace(/:\d+:\d+$/, "")],
        queryFn: ({ signal }) => fetchPlaybackId(id.replace(/:\d+:\d+$/, ""), type as "movie" | "series", AbortSignal.any([signal, AbortSignal.timeout(15_000)])),
    });
    const resolveIdentity = (id: string, type: string) => {
        const base = id.replace(/:\d+:\d+$/, "");
        const seeded = client.getQueryData<string>(["metadata", scope, "identity", type, base]);
        return seeded ? Promise.resolve(seeded) : /^tmdb:/.test(id) ? client.query(identityOptions(id, type)).finally(() => prune()) : Promise.resolve(base);
    };
    const peekIdentity = (id: string, type: string) => client.getQueryData<string>(["metadata", scope, "identity", type, id.replace(/:\d+:\d+$/, "")]) || (/^tmdb:/.test(id) ? client.getQueryData<string>(identityOptions(id, type).queryKey) : id.replace(/:\d+:\d+$/, ""));
    const keyFor = (target: Target) => `${generation}:${target.type}:${target.id}`;
    const addonKey = (type: string, revision = generation) => [...root, "addons", revision, type] as const;
    const providerKey = (revision: string, type: string, id: string, index: number) => [...root, "streams", revision, type, id, index] as const;
    const peek = (target: Target): PlaybackStreamSnapshot | undefined => {
        const active = aliases.get(keyFor(target))?.request.snapshot;
        if (active?.complete || active?.streams.length) return active;
        const base = target.id.replace(/:\d+:\d+$/, "");
        const identity = peekIdentity(base, target.type);
        const addons = client.getQueryData<Addons>(addonKey(target.type));
        if (!identity || !addons) return;
        const id = identity + target.id.slice(base.length);
        const cached = addons.addons.map((_, index) => client.getQueryState<StreamWithAddon[]>(providerKey(addons.revision, target.type, id, index)));
        const pending = cached.filter(state => state?.data === undefined || state.isInvalidated).length;
        const streams = cached.flatMap(state => state?.isInvalidated ? [] : state?.data ?? []);
        if (pending && !streams.length) return;
        return { streams, pending, total: cached.length, complete: pending === 0 };
    };
    const read = async <T,>(url: string, signal: AbortSignal): Promise<T> => {
        const response = await fetchFn(url, { signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not fetch streams. Check your connection and try again.");
        return response.json() as Promise<T>;
    };
    const stop = (entry: Entry) => {
        if (entry.dead) return;
        entry.dead = true; entry.controller.abort();
        entry.cleanups.splice(0).forEach(cleanup => cleanup());
        entries.delete(entry);
        for (const [key, value] of aliases) if (value === entry) aliases.delete(key);
        // Only this entry's last observer may cancel a query. Other targets or
        // aliases can still own the same provider query.
        for (const key of entry.keys) {
            const query = client.getQueryCache().find({ queryKey: key, exact: true });
            if (query && !query.getObserversCount() && query.state.fetchStatus === "fetching") {
                void client.cancelQueries({ queryKey: key, exact: true });
            }
        }
    };
    const prune = () => {
        const idleEntries = [...entries].filter(entry => !entry.required && !entry.speculative).sort((a, b) => a.started - b.started);
        for (const entry of idleEntries.slice(0, Math.max(0, idleEntries.length - 12))) stop(entry);
        const protectedKeys = new Set([...entries].filter(entry => entry.required || entry.speculative)
            .flatMap(entry => entry.keys.map(key => JSON.stringify(key))));
        const unused = client.getQueryCache().findAll({ queryKey: root }).filter(query => query.queryKey[2] === "streams"
            ? !protectedKeys.has(JSON.stringify(query.queryKey)) : !query.getObserversCount());
        const streams = unused.filter(query => query.queryKey[2] === "streams");
        const groups = new Map<string, typeof streams>();
        for (const query of streams) {
            if (query.state.status === "error" || !Array.isArray(query.state.data)) {
                if (query.state.fetchStatus !== "fetching") client.removeQueries({ queryKey: query.queryKey, exact: true });
                continue;
            }
            const key = JSON.stringify(query.queryKey.slice(0, -1));
            groups.set(key, [...groups.get(key) || [], query]);
        }
        const usedAt = (group: typeof streams) => lastUse.get(JSON.stringify(group[0].queryKey.slice(0, -1))) ?? Math.max(...group.map(q => q.state.dataUpdatedAt));
        const ordered = [...groups.values()].sort((a, b) => usedAt(a) - usedAt(b));
        let bytes = ordered.reduce((sum, group) => sum + group.reduce((size, q) => size + payloadBytes(q), 0), 0);
        while (ordered.length > 12 || bytes > 8 * 1024 * 1024) {
            for (const query of ordered.shift() || []) {
                bytes -= payloadBytes(query);
                for (const entry of entries) if (!entry.required && !entry.speculative
                    && entry.keys.some(key => JSON.stringify(key) === JSON.stringify(query.queryKey))) stop(entry);
                client.removeQueries({ queryKey: query.queryKey, exact: true });
            }
        }
        const ids = unused.filter(query => query.queryKey[2] === "id").sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
        for (const query of ids.slice(0, Math.max(0, ids.length - 128))) client.removeQueries({ queryKey: query.queryKey, exact: true });
        const live = new Set(client.getQueryCache().findAll({ queryKey: root }).map(query => JSON.stringify(query.queryKey.slice(0, -1))));
        for (const key of lastUse.keys()) if (!live.has(key)) lastUse.delete(key);
    };
    const scheduleRelease = (entry: Entry) => {
        if (entry.dead || entry.required) return;
        if (entry.speculative) {
            if (Date.now() - entry.started >= 30_000) stop(entry);
            return;
        }
        const finish = () => {
            if (entry.required || entry.speculative) return;
            stop(entry); prune();
        };
        // Keep unfinished route-to-player handoffs alive until their original
        // budget, including Strict Mode cleanup/setup in the same frame.
        if (entry.completed) queueMicrotask(finish);
        else {
            const timer = setTimeout(finish, Math.max(0, entry.started + 30_000 - Date.now()));
            entry.cleanups.push(() => clearTimeout(timer));
        }
        prune();
    };
    const lease = (entry: Entry, purpose: Purpose, signal?: AbortSignal) => {
        if (purpose === "required") entry.required++; else entry.speculative++;
        let active = true;
        const release = () => {
            if (!active) return;
            active = false; signal?.removeEventListener("abort", release);
            if (purpose === "required") entry.required--; else entry.speculative--;
            scheduleRelease(entry);
        };
        if (signal?.aborted) release(); else signal?.addEventListener("abort", release, { once: true });
        return release;
    };
    const invalidate = (target?: Target) => {
        if (!target) { client.removeQueries({ queryKey: ["subtitles", scope] }); }
        if (target) {
            const base = target.id.replace(/:\d+:\d+$/, "");
            const id = (peekIdentity(base, target.type) || base) + target.id.slice(base.length);
            void client.invalidateQueries({ queryKey: root, predicate: query => query.queryKey[2] === "streams"
                && query.queryKey[4] === target.type && query.queryKey[5] === id, refetchType: "none" });
        }
        for (const entry of entries) if (!target || (entry.target.type === target.type && (entry.target.id === target.id || aliases.get(keyFor(target)) === entry))) {
            for (const [key, value] of aliases) if (value === entry) aliases.delete(key);
            void client.invalidateQueries({ queryKey: root, predicate: query => entry.keys.some(key => JSON.stringify(key) === JSON.stringify(query.queryKey)), refetchType: "none" });
            if (!entry.required) stop(entry);
        }
        if (!target) {
            generation++;
            void client.invalidateQueries({ queryKey: ["metadata", scope], refetchType: "none" });
            void client.invalidateQueries({ queryKey: root, refetchType: "none" });
        }
    };
    const make = (target: Target): Entry => {
        const listeners = new Set<(_snapshot: PlaybackStreamSnapshot) => void>();
        const controller = new AbortController();
        let resolveId!: (_id: string) => void, rejectId!: (_error: unknown) => void;
        const request: PlaybackStreamRequest = {
            ...target, canonicalId: new Promise<string>((resolve, reject) => { resolveId = resolve; rejectId = reject; }),
            snapshot: { streams: [], total: 0, pending: 0, complete: false }, promise: undefined!,
            subscribe(listener) { listeners.add(listener); listener(request.snapshot); return () => { listeners.delete(listener); }; },
        };
        const entry: Entry = { request, target, generation, started: Date.now(), required: 0, speculative: 0,
            completed: false, dead: false, cleanups: [], keys: [], controller };
        entries.add(entry); aliases.set(keyFor(target), entry);
        request.retain = signal => lease(entry, "required", signal);
        request.invalidate = () => invalidate(target);
        request.cancel = () => { if (!entry.required) stop(entry); };
        const deadline = setTimeout(() => stop(entry), 45_000);
        entry.cleanups.push(() => clearTimeout(deadline));
        const speculativeDeadline = setTimeout(() => { if (!entry.required) stop(entry); }, 30_000);
        entry.cleanups.push(() => clearTimeout(speculativeDeadline));
        const publish = (snapshot: PlaybackStreamSnapshot) => {
            if (entry.dead) return;
            const previous = request.snapshot;
            if (previous.pending === snapshot.pending && previous.total === snapshot.total && previous.complete === snapshot.complete
                && previous.settledPrefix === snapshot.settledPrefix && previous.streams.length === snapshot.streams.length
                && previous.streams.every((stream, index) => stream === snapshot.streams[index])) return;
            request.snapshot = snapshot;
            for (const listener of listeners) listener(snapshot);
            if (!entry.required && !entry.speculative) prune();
        };
        const operation = (async () => {
            const base = target.id.replace(/:\d+:\d+$/, "");
            const canonical = resolveIdentity(base, target.type).then(id => id + target.id.slice(base.length));
            const addonsOptions = queryOptions({ ...STREAM_QUERY_DEFAULTS,
                queryKey: addonKey(target.type, entry.generation),
                queryFn: ({ signal }) => read<Addons>("/api/streams/addons?" + new URLSearchParams({ type: target.type }), AbortSignal.any([signal, AbortSignal.timeout(15_000)])),
            });
            // The metadata operations don't depend on one another.
            const [id, targets] = await Promise.all([canonical, client.query(addonsOptions)]);
            if (entry.dead) throw new DOMException("Aborted", "AbortError");
            resolveId(id);
            const canonicalAlias = `${entry.generation}:${target.type}:${id}`;
            const shared = aliases.get(canonicalAlias);
            if (shared && shared !== entry && !shared.completed && !shared.dead) {
                // Join the aggregate, not just its provider keys: an early
                // provider may have aged while a slow peer is still pending.
                entry.started = shared.started;
                entry.keys = shared.keys;
                const release = lease(shared, "required");
                entry.cleanups.push(release, shared.request.subscribe(publish));
                const budget = setTimeout(() => { if (!entry.required) stop(entry); }, Math.max(0, shared.started + 30_000 - Date.now()));
                entry.cleanups.push(() => clearTimeout(budget));
                return shared.request.promise;
            }
            if (!aliases.has(canonicalAlias)) aliases.set(canonicalAlias, entry);
            const settled = targets.addons.map(() => false), ready = targets.addons.map(() => false);
            const update = () => {
                let settledPrefix = 0;
                while (settled[settledPrefix]) settledPrefix++;
                publish({ streams: entry.keys.flatMap((key, i) => ready[i] ? client.getQueryData<StreamWithAddon[]>(key) || [] : []),
                    total: settled.length, pending: settled.filter(value => !value).length,
                    complete: settled.every(Boolean), settledPrefix });
            };
            const options = targets.addons.map((addon, index) => queryOptions({ ...STREAM_QUERY_DEFAULTS,
                queryKey: providerKey(targets.revision, target.type, id, index),
                queryFn: async ({ signal }) => {
                    const data = await read<{ streams: StremioStream[] }>("/api/streams/addon?" + new URLSearchParams({
                        type: target.type, mediaItemId: id, addonId: addon.id,
                    }), AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
                    return data.streams.map(stream => ({ ...stream, addonId: addon.id, addonName: addon.name, addonIndex: index }));
                },
            }));
            entry.keys = options.map(option => option.queryKey);
            for (const key of entry.keys) lastUse.set(JSON.stringify(key.slice(0, -1)), Date.now());
            const work = options.map((option, index) => {
                // Passive observers keep the shared query alive across page
                // teardown; acquisition alone decides when to fetch.
                const observer = new QueryObserver(client, { ...option, enabled: false });
                entry.cleanups.push(observer.subscribe(() => { if (!entry.completed) update(); }));
                return client.query(option).then(() => { ready[index] = true; }, () => {}).finally(() => { settled[index] = true; update(); });
            });
            update(); await Promise.all(work);
            controller.signal.throwIfAborted();
            if (targets.addons.length && !request.snapshot.streams.length && ready.some(value => !value)) {
                throw new Error("Could not load streams from your add-ons. Try again.");
            }
            return request.snapshot.streams;
        })();
        request.promise = new Promise<StreamWithAddon[]>((resolve, reject) => {
            const abort = () => reject(new DOMException("Aborted", "AbortError"));
            controller.signal.addEventListener("abort", abort, { once: true });
            operation.then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
        });
        void request.canonicalId.catch(() => {});
        void request.promise.then(() => {
            entry.completed = true; clearTimeout(deadline); scheduleRelease(entry);
        }, error => { rejectId(error); entry.completed = true; stop(entry); prune(); });
        return entry;
    };
    const acquire = (target: Target, purpose: Purpose = "required", signal?: AbortSignal) => {
        if (disposed) throw new Error("This playback session has ended.");
        signal?.throwIfAborted();
        let entry = aliases.get(keyFor(target));
        if (entry?.completed && (entry.dead || !entry.keys.length || entry.keys.some(key => {
            const state = client.getQueryState<StreamWithAddon[]>(key);
            return !state || !Array.isArray(state.data) || state.isInvalidated || Date.now() - state.dataUpdatedAt >= 30_000;
        }))) entry = undefined;
        if (!entry || entry.dead) {
            if (purpose === "speculative") {
                const speculative = [...entries].filter(value => !value.required && !value.dead);
                if (speculative.length >= 2) stop(speculative[0]);
            }
            entry = make(target);
        }
        for (const key of entry.keys) lastUse.set(JSON.stringify(key.slice(0, -1)), Date.now());
        return { request: entry.request, release: lease(entry, purpose, signal) };
    };
    const create = (id: string, type: string, signal?: AbortSignal, purpose: Purpose = "required") => {
        const { request, release } = acquire({ id, type }, purpose, signal);
        void request.promise.then(release, release);
        return request;
    };
    return { client, scope, resolveIdentity, peekIdentity, peek, acquire, create, speculate: (id: string, type: string, signal?: AbortSignal) => create(id, type, signal, "speculative"),
        invalidate, prune,
        clear() { if (disposed) return; disposed = true; for (const entry of entries) stop(entry); lastUse.clear(); client.clear(); },
    };
}
export type StreamQueries = ReturnType<typeof createStreamQueries>;
