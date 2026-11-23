import type { Episode } from "@/app/actions/tv-shows";

type Entry = {
    controller: AbortController;
    promise: Promise<Episode[]>;
    settled: boolean;
    refs: number;
    expires: number;
};
const seasons = new Map<string, Entry>();
const MAX_SEASONS = 48;
function trimSettled() {
    while (seasons.size > MAX_SEASONS) {
        const oldest = [...seasons].find(([, entry]) => entry.settled);
        if (!oldest) return;
        seasons.delete(oldest[0]);
    }
}

export function invalidateSeriesSeasons() {
    seasons.clear();
}

/** Share one metadata read between episode cards and streams.
 * Progress/watched state never enters this cache. Last-consumer cleanup aborts
 * pending reads; failed reads and Strict Mode replay remain retryable. */
export function acquireSeriesSeason(id: string, season: number) {
    const key = `${id}:${season}`;
    let entry = seasons.get(key);
    if (!entry || entry.controller.signal.aborted || (entry.settled && entry.expires <= Date.now())) {
        const controller = new AbortController();
        const created: Entry = {
            controller, settled: false, refs: 0, expires: 0,
            promise: readSeason(id, season, controller.signal).then(episodes => {
                created.settled = true;
                created.expires = Date.now() + 300_000;
                trimSettled();
                return episodes;
            }).catch(error => {
                if (seasons.get(key) === created) seasons.delete(key);
                throw error;
            }),
        };
        entry = created;
        seasons.set(key, entry);
        trimSettled();
    } else {
        seasons.delete(key); seasons.set(key, entry);
    }
    entry.refs++;
    const current = entry;
    let released = false;
    return {
        promise: entry.promise,
        release() {
            if (released) return;
            released = true;
            if (--current.refs === 0 && !current.settled) current.controller.abort();
        },
    };
}

async function readSeason(id: string, season: number, signal: AbortSignal): Promise<Episode[]> {
    const response = await fetch(`/api/series/episodes?${new URLSearchParams({ id, season: String(season) })}`, { signal });
    if (!response.ok) throw new Error("Couldn't load this season.");
    const episodes = await response.json() as Episode[];
    signal.throwIfAborted();
    if (!Array.isArray(episodes)) throw new Error("Invalid season response.");
    return episodes;
}
