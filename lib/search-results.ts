import type { SearchMediaFilter, SearchResultPage, SearchResultSet } from "./search-presentation";

export interface SearchFeed extends SearchResultPage {
    nextPage: number;
    loading: boolean;
    error: string | null;
}
const identity = (item: { type: string; id: string }) => `${item.type}:${item.id}`;
function unique(items: SearchResultPage["results"]) {
    return [...new Map(items.map(item => [identity(item), item])).values()];
}

/** Each filter retains its ranking and loaded cards. A request owns its result
 * until a filter/query change or unmount cancels it, even if fetch ignores abort. */
export function createSearchResultsStore(initial: SearchResultSet,
    load: (filter: SearchMediaFilter, page: number, signal: AbortSignal) => Promise<SearchResultPage>,
) {
    const cards = new Map<string, SearchResultPage["results"][number]>();
    const canonical = (items: SearchResultPage["results"]) => unique(items).map(item => {
        const key = identity(item), existing = cards.get(key);
        if (existing) return existing;
        cards.set(key, item);
        return item;
    });
    const feed = (page: SearchResultPage): SearchFeed => ({ ...page, results: canonical(page.results), nextPage: 2, loading: false, error: null });
    let snapshot = { all: feed(initial.all), movie: feed(initial.movie), series: feed(initial.series), person: feed(initial.person) };
    let active: SearchMediaFilter | null = null;
    let request: { filter: SearchMediaFilter; controller: AbortController } | null = null;
    const listeners = new Set<() => void>();
    function update(filter: SearchMediaFilter, patch: Partial<SearchFeed>) {
        snapshot = { ...snapshot, [filter]: { ...snapshot[filter], ...patch } };
        listeners.forEach(listener => listener());
    }
    function cancel() {
        const previous = request;
        request = null;
        previous?.controller.abort();
        if (previous) update(previous.filter, { loading: false });
    }
    return {
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        getSnapshot: () => snapshot,
        activate(filter: SearchMediaFilter) { if (filter !== active) cancel(); active = filter; },
        stop() { active = null; cancel(); },
        async loadMore(filter: SearchMediaFilter, retry = false) {
            const current = snapshot[filter];
            if (active !== filter || request || (current.error && !retry) || current.nextPage > Math.min(500, current.totalPages)) return;
            const owner = { filter, controller: new AbortController() };
            request = owner;
            update(filter, { loading: true, error: null });
            try {
                const page = await load(filter, current.nextPage, owner.controller.signal);
                if (request !== owner || owner.controller.signal.aborted) return;
                const seen = new Set(current.results.map(identity));
                const added = canonical(page.results).filter(item => !seen.has(identity(item)));
                request = null;
                update(filter, {
                    results: [...current.results, ...added], totalPages: page.totalPages, totalResults: page.totalResults,
                    nextPage: current.nextPage + 1, loading: false,
                });
            } catch (error) {
                if (request !== owner || owner.controller.signal.aborted) return;
                request = null;
                update(filter, { loading: false, error: error instanceof Error ? error.message : "Could not load more titles. Try again." });
            } finally {
                if (request === owner) request = null;
            }
        },
    };
}
