import type { Episode } from "@/app/actions/tv-shows";
import type { MediaToPlay } from "@/lib/atoms";

export const UP_NEXT_SECONDS = 5;
export const NEXT_EPISODE_PREFETCH_WINDOW = 5 * 60;
export const NEXT_EPISODE_PREFETCH_TTL = 6 * 60_000;
export interface EpisodePreload { claim(): void; dispose(): void }
export function shouldPrefetchEpisode(position: number, duration: number, creditsStart?: number): boolean {
    const end = Number.isFinite(creditsStart) && creditsStart! > 0 && creditsStart! <= duration ? creditsStart! : duration;
    return Number.isFinite(position) && Number.isFinite(duration) && duration > 0 && position > 0
    && position < duration && end - position <= Math.min(NEXT_EPISODE_PREFETCH_WINDOW, duration * .25);
}
export function nextEpisodeRequest(media: MediaToPlay, next: Episode): MediaToPlay {
    const id = media.seriesId || media.id;
    return {
        id, seriesId: id, type: "series", name: next.title, episodeTitle: next.title,
        showName: media.showName || media.details?.name, backdropUrl: media.backdropUrl,
        details: media.details, detailsLoaded: false,
        mediaSourceId: next.id, seasonNumber: next.season, episodeNumber: next.episode,
        episodeReleasePreference: { filename: media.subtitleFilename, url: media.streamUrl },
    };
}

/** One playback session owns at most one following episode and one preparation. */
export class EpisodeContinuation {
    private controller = new AbortController();
    private preparationController = new AbortController();
    private lookup?: Promise<Episode | null>;
    private prepared?: Promise<MediaToPlay>;
    private preparedAt = 0;
    private advancing?: Promise<boolean>;
    private moved = false;
    private prefetched = false;
    private warming = false;
    private preload?: EpisodePreload;
    private warmingController = new AbortController();
    constructor(private _dependencies: {
    current(): MediaToPlay;
    isCurrent?(): boolean;
    season: number; episode: number;
    lookup(_signal: AbortSignal): Promise<Episode | null>;
    prepare(_media: MediaToPlay, _signal: AbortSignal): Promise<MediaToPlay>;
    warm?(_media: MediaToPlay, _signal: AbortSignal): Promise<EpisodePreload | void>;
    beforeAdvance(_ended: boolean): void;
    play(_media: MediaToPlay): void;
    now?: () => number;
  }) {}
    get advanced() { return this.moved; }
    get active() { return !this.controller.signal.aborted && (this._dependencies.isCurrent?.() ?? true); }
    next(): Promise<Episode | null> {
        return this.lookup ??= this._dependencies.lookup(this.controller.signal).then(next => {
            const { season, episode } = this._dependencies;
            return this.active && next && next.season > 0 && (next.season > season || next.season === season && next.episode > episode)
        && (!next.released || Date.parse(next.released) <= Date.now()) ? next : null;
        }).catch(() => { this.lookup = undefined; return null; });
    }
    private async prepare(): Promise<MediaToPlay | null> {
        const signal = AbortSignal.any([this.controller.signal, this.preparationController.signal]);
        const next = await this.next();
        if (!next || !this.active || signal.aborted) return null;
        const now = this._dependencies.now || Date.now;
        if (this.prepared && this.preparedAt && now() - this.preparedAt > NEXT_EPISODE_PREFETCH_TTL) {
            this.suspendVideoPrefetch(); this.prepared = undefined;
        }
        if (!this.prepared) {
            const operation = this._dependencies.prepare(nextEpisodeRequest(this._dependencies.current(), next), signal)
                .then(media => { if (this.prepared === operation) this.preparedAt = now(); return media; })
                .catch(error => { if (this.prepared === operation) this.prepared = undefined; throw error; });
            this.prepared = operation;
        }
        return this.prepared;
    }
    async prefetch(allowVideo = true) {
        if (this.preparedAt && (this._dependencies.now || Date.now)() - this.preparedAt > NEXT_EPISODE_PREFETCH_TTL) this.cancelPrefetch();
        if (!this.active || this.moved || (this.prefetched && (!allowVideo || this.warming))) return;
        this.prefetched = true;
        const signal = AbortSignal.any([this.controller.signal, this.preparationController.signal]);
        try {
            const media = await this.prepare();
            if (this.active && !signal.aborted && !this.moved && media && allowVideo && !this.warming) {
                this.warming = true;
                const warmSignal = AbortSignal.any([signal, this.warmingController.signal]);
                const preload = await this._dependencies.warm?.(media, warmSignal);
                if (!this.active || warmSignal.aborted || this.moved) preload?.dispose();
                else this.preload = preload || undefined;
            }
        } catch { /* Optional preparation cannot interrupt the current episode. */ }
    }
    advance(ended = false): Promise<boolean> {
        if (!this.active || this.moved) return Promise.resolve(false);
        if (this.advancing) return this.advancing;
        return this.advancing = (async () => {
            const next = await this.next();
            if (!next || !this.active) return false;
            // An unprepared manual/automatic advance opens the normal player loader
            // immediately. An in-flight prefetch is shared instead of duplicated.
            let media: MediaToPlay;
            if (this.prepared) {
                try { media = await this.prepare() || nextEpisodeRequest(this._dependencies.current(), next); }
                catch { media = nextEpisodeRequest(this._dependencies.current(), next); }
            } else media = nextEpisodeRequest(this._dependencies.current(), next);
            if (!this.active || this.moved) return false;
            this.preload?.claim();
            this.moved = true;
            this._dependencies.beforeAdvance(ended);
            this._dependencies.play(media);
            return true;
        })().finally(() => { this.advancing = undefined; });
    }
    cancelPrefetch() {
        if (!this.prefetched && !this.prepared && !this.warming && !this.preload) return;
        this.suspendVideoPrefetch();
        this.preparationController.abort();
        this.preparationController = new AbortController();
        this.prepared = undefined; this.preparedAt = 0; this.prefetched = false;
    }
    suspendVideoPrefetch() {
        if (!this.warming && !this.preload) return;
        this.warmingController.abort(); this.warmingController = new AbortController();
        this.preload?.dispose(); this.preload = undefined; this.warming = false;
    }
    dispose() { this.preload?.dispose(); this.controller.abort(); this.preparationController.abort(); this.warmingController.abort(); }
}
