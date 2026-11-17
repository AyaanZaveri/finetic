import { QueryObserver, queryOptions, type QueryClient } from "@tanstack/react-query";
import type { CurrentMediaWithSource } from "@/lib/atoms";
import { fetchPlaybackSubtitles, fetchPlaybackSubtitleFile, type SubtitleHints, type PlaybackSubtitleTrack, type SubtitleFile } from "./playback-subtitles";
import { parseSubtitleTextContent, type ParsedSubtitleEntry } from "./subtitle-content";
import { isEnglishSubtitle, isForcedSubtitle, isSDHSubtitle, navigatorSubtitleRank } from "./subtitle-preference";
import { subtitleMediaKey, subtitleSnapshotSchema, type SubtitleSnapshot } from "./subtitle-snapshot";

const defaults = { retry: false, gcTime: 15 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/** Caller cancellation never cancels another consumer's shared request. */
function interest<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

/** One verified browser session owns catalogs, files and parsed cues. No disk persistence. */
export function createSubtitleQueries(client: QueryClient, scope: string,
    tracks = fetchPlaybackSubtitles, content = fetchPlaybackSubtitleFile) {
    const root = ["subtitles", scope];
    let playback: { mediaKey: string; tracks: PlaybackSubtitleTrack[]; selectedSrc?: string; delay: number } | undefined;
    const fileOptions = (src: string, mediaKey: string) => queryOptions({ ...defaults, queryKey: [...root, "file", src, mediaKey], staleTime: Infinity,
        queryFn: async ({ signal }): Promise<SubtitleFile> => {
            const result = await content(src, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
            if (!result.success) throw Error(result.error || "Subtitle download failed");
            const cues = parseSubtitleTextContent(result.content);
            if (!cues.length) throw Error("No subtitle cues found");
            return { ...result, cues };
        } });
    const prune = () => {
        const queries = client.getQueryCache().findAll({ queryKey: root }).filter(query => query.state.fetchStatus !== "fetching");
        const preferred = playback?.tracks.filter(track => !isForcedSubtitle(track))
            .sort((a, b) => navigatorSubtitleRank(b) - navigatorSubtitleRank(a))[0];
        const pinned = new Set([playback?.selectedSrc, preferred?.src]);
        const idle = queries.filter(query => !query.getObserversCount()
            && !(query.queryKey[2] === "file" && query.queryKey[4] === playback?.mediaKey && pinned.has(String(query.queryKey[3]))))
            .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
        let bytes = queries.reduce((size, query) => size + new TextEncoder().encode(JSON.stringify(query.state.data) || "").byteLength, 0);
        let count = queries.length;
        for (const query of idle) {
            if (count <= 24 && bytes <= 8 * 1024 * 1024 && query.state.status !== "error") continue;
            bytes -= new TextEncoder().encode(JSON.stringify(query.state.data) || "").byteLength;
            count--; client.removeQueries({ queryKey: query.queryKey, exact: true });
        }
    };
    const file = (src: string, signal?: AbortSignal, mediaKey = "") => {
        signal?.throwIfAborted();
        return interest(client.query(fileOptions(src, mediaKey)), signal).finally(prune);
    };
    return {
        file, prune,
        discover(id: string, type: string, hints: SubtitleHints = {}, signal?: AbortSignal) {
            signal?.throwIfAborted();
            return interest(client.query(queryOptions({ ...defaults, staleTime: 60_000,
                queryKey: [...root, "catalog", type, id, hints.filename || "", hints.videoSize || 0, hints.episodeTitle || ""],
                queryFn: ({ signal }) => tracks(id, type, hints, AbortSignal.any([signal, AbortSignal.timeout(20_000)])),
            })), signal).finally(prune);
        },
        publish(media: CurrentMediaWithSource, tracks: PlaybackSubtitleTrack[], selectedSrc: string | undefined, delay: number, selectedCues?: ParsedSubtitleEntry[]) {
            const owner = { mediaKey: subtitleMediaKey(media), tracks, selectedSrc, delay };
            playback = owner;
            // Early discovery can lack final release hints. Seed the exact final key
            // from the captions actually applied, without another network read/parse.
            if (selectedSrc && selectedCues?.length && !client.getQueryData(fileOptions(selectedSrc, owner.mediaKey).queryKey)) {
                client.setQueryData(fileOptions(selectedSrc, owner.mediaKey).queryKey, { success: true, content: "", cues: selectedCues });
            }
            const preferred = tracks.filter(track => !isForcedSubtitle(track)).sort((a, b) => navigatorSubtitleRank(b) - navigatorSubtitleRank(a))[0];
            // Prepare one full English transcript while playback is already
            // active. Navigator then reads parsed cues without a catalog round trip.
            if (preferred && isEnglishSubtitle(preferred)) void file(preferred.src, undefined, owner.mediaKey).catch(() => {});
            const stops = [...new Set([selectedSrc, preferred?.src])].flatMap(src => {
                if (!src) return [];
                const observer = new QueryObserver(client, { ...fileOptions(src, owner.mediaKey), enabled: false });
                return [observer.subscribe(() => {})];
            });
            return () => { stops.forEach(stop => stop()); if (playback === owner) playback = undefined; prune(); };
        },
        async snapshot(media: CurrentMediaWithSource | null, signal?: AbortSignal): Promise<SubtitleSnapshot | undefined> {
            const owner = playback;
            if (!media || !owner || owner.mediaKey !== subtitleMediaKey(media)) return undefined;
            // A chat request never waits for a downloading transcript. Full English
            // cues are prepared during playback; the server handles a cold lookup.
            const english = owner.tracks.filter(track => !isForcedSubtitle(track) && isEnglishSubtitle(track));
            const highestRank = Math.max(...english.map(navigatorSubtitleRank));
            const candidates = english.filter(track => navigatorSubtitleRank(track) === highestRank)
                .filter(track => { const state = client.getQueryState(fileOptions(track.src, owner.mediaKey).queryKey);
                    return state?.status === "success"; })
                .sort((a, b) => navigatorSubtitleRank(b) - navigatorSubtitleRank(a)
                    || Number(b.src === owner.selectedSrc) - Number(a.src === owner.selectedSrc));
            for (const track of candidates) {
                try {
                    const result = await file(track.src, signal, owner.mediaKey);
                    if (playback !== owner) return undefined;
                    // Strip URLs and credentials. Only bounded transcript data crosses the chat boundary.
                    const snapshot = subtitleSnapshotSchema.safeParse({ mediaKey: owner.mediaKey,
                        delay: owner.delay,
                        track: { label: track.label, language: track.language, filename: track.filename, provider: track.provider, sdh: isSDHSubtitle(track), forced: isForcedSubtitle(track) }, cues: result.cues });
                    if (snapshot.success) return snapshot.data;
                } catch { signal?.throwIfAborted(); }
            }
            return undefined;
        },
        dispose() { playback = undefined; client.removeQueries({ queryKey: root }); },
    };
}
export type SubtitleQueries = ReturnType<typeof createSubtitleQueries>;
