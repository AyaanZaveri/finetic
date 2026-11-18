import { episodeHeroStillUrl } from "@/lib/artwork";
import type { MediaToPlay } from "@/lib/atoms";
import type { MetadataQueries } from "./metadata-queries";
import { metadataTarget } from "./metadata";
import { playbackBackdrop } from "./playback-details";

/** Image bytes belong to the browser cache, never to the query cache. */
export function createMetadataImageQueue() {
    const queue: string[] = [];
    const recent = new Set<string>();
    const active = new Set<() => void>();
    const pump = () => {
        while (queue.length && active.size < 2) {
            const source = queue.shift()!;
            const url = new URL(source, document.baseURI).href;
            if ([...document.images].some(image => image.currentSrc === url || image.src === url)) continue;
            const image = new Image();
            image.fetchPriority = "low";
            if (source.includes("sample=1")) image.crossOrigin = "anonymous";
            const finish = () => { clearTimeout(timer); image.onload = image.onerror = null; active.delete(cancel); pump(); };
            const cancel = () => { image.removeAttribute("src"); finish(); };
            const timer = setTimeout(cancel, 15_000);
            image.onload = image.onerror = finish;
            active.add(cancel); image.src = source;
        }
    };
    return {
        add(source?: string) {
            if (!source || recent.has(source) || typeof document === "undefined") return;
            recent.add(source); if (recent.size > 256) recent.delete(recent.values().next().value!);
            queue.push(source); pump();
        },
        clear() { queue.length = 0; for (const cancel of [...active]) cancel(); recent.clear(); },
    };
}
export function createMetadataWarmup(queries: MetadataQueries) {
    type Job = { key: string; media: MediaToPlay; intent: boolean; controller: AbortController };
    const queue: Job[] = [];
    const active = new Map<string, Job>();
    const recent = new Set<string>();
    const images = createMetadataImageQueue();
    let allowed = false;
    const warmArt = (media: MediaToPlay, intent: boolean) => {
        const cached = queries.peek(media);
        const logo = cached.title?.data.artwork.logo;
        images.add(logo);
        images.add(episodeHeroStillUrl(cached.episode?.data.still));
        if (intent && !playbackBackdrop(media)) images.add(cached.title?.data.artwork.backdrop);
    };
    const pump = () => {
        while (allowed && active.size < 2 && queue.length) {
            const job = queue.shift()!;
            active.set(job.key, job);
            void queries.prepare(job.media, "speculative", job.controller.signal).then(() => {
                if (!job.controller.signal.aborted && allowed) warmArt(job.media, job.intent);
            }).catch(() => {}).finally(() => { active.delete(job.key); pump(); });
        }
    };
    const clear = () => {
        queue.length = 0;
        for (const job of active.values()) job.controller.abort();
        queries.cancelSpeculation(); images.clear(); recent.clear();
    };
    const unsubscribe = queries.client.getQueryCache().subscribe(event => {
        if (event.type === "updated" && event.action.type === "invalidate" && event.query.queryKey[0] === "metadata"
            && event.query.queryKey[1] === queries.scope && event.query.queryKey[2] === "config") clear();
    });
    return {
        setAllowed(value: boolean) { allowed = value; if (!value) clear(); else pump(); },
        enqueue(media: MediaToPlay, intent = false) {
            if (!allowed || media.type !== "series" && media.type !== "movie") return;
            if (intent) images.add(playbackBackdrop(media));
            const target = metadataTarget(media), key = `${target.type}:${target.id}:${target.season ?? ""}:${target.episode ?? ""}`;
            const running = active.get(key);
            if (running) { running.intent ||= intent; return; }
            const queued = queue.find(job => job.key === key);
            if (queued) { if (intent) { queued.intent = true; queue.splice(queue.indexOf(queued), 1); queue.unshift(queued); } return; }
            if (recent.has(key)) {
                if (!intent || queries.peek(media).title) { if (intent) warmArt(media, true); return; }
                recent.delete(key);
            }
            recent.add(key); if (recent.size > 256) recent.delete(recent.values().next().value!);
            const job = { key, media, intent, controller: new AbortController() };
            if (intent) queue.unshift(job); else queue.push(job);
            if (queue.length > 16) queue.pop();
            pump();
        },
        clear,
        dispose() { allowed = false; unsubscribe(); clear(); },
    };
}
