"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState, type MouseEvent } from "react";
import { Layers, ListVideo, Loader2, Play, X } from "lucide-react";
import { fetchEpisodes, fetchSeasons, type Episode, type Season } from "@/app/actions/tv-shows";
import { ArtworkImage } from "@/components/artwork-image";
import { MediaActions } from "@/components/media-actions";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Select } from "@/components/arc/select/select";
import seasonStyles from "@/components/season-episodes.module.css";
import artworkStyles from "@/components/media-page/detail-artwork.module.css";
import cardStyles from "@/components/media-card.module.css";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import drawerStyles from "./player-selection-controls.module.css";
import { episodeThumbnailUrl } from "@/lib/artwork";
import { formatReleaseDate } from "@/lib/format-release-date";
import { formatRuntime } from "@/lib/format-runtime";
import { acquireSeriesSeason } from "@/lib/media/series-season";
import type { MediaItem, StremioStream } from "@/types/stremio";

type Panel = "episodes" | "streams";
type DrawerPanel =
    | { view: "episodes"; container: HTMLElement; season: number }
    | { view: "streams"; container: HTMLElement };
type DrawerState = { open: false; panel: null } | { open: boolean; panel: DrawerPanel };
type DrawerEvent =
    | { type: "open"; panel: Panel; container: HTMLElement; season: number }
    | { type: "choose-season"; season: number }
    | { type: "close" }
    | { type: "finish-close" };

const closed: DrawerState = { open: false, panel: null };

function drawerTransition(state: DrawerState, event: DrawerEvent): DrawerState {
    switch (event.type) {
    case "open":
        return { open: true, panel: event.panel === "episodes"
            ? { view: "episodes", container: event.container, season: event.season }
            : { view: "streams", container: event.container } };
    case "choose-season":
        return state.open && state.panel.view === "episodes"
            ? { ...state, panel: { ...state.panel, season: event.season } } : state;
    case "close":
        return state.open ? { ...state, open: false } : state;
    case "finish-close":
        return state.open ? state : closed;
    }
}

type PlayingEpisode = { seriesId: string; season: number; episode: number };

export function PlayerSelectionControls({ media, streamUrl, playingEpisode, onEpisodeSelect, onStreamSelect }: {
    media: MediaItem;
    streamUrl: string | null;
    playingEpisode?: PlayingEpisode;
    onEpisodeSelect(_episode: Episode): void;
    onStreamSelect(_stream: StremioStream): void;
}) {
    const [state, dispatch] = useReducer(drawerTransition, closed);
    const opener = useRef<HTMLButtonElement | null>(null);
    const afterClose = useRef<(() => void) | null>(null);
    const [popup, setPopup] = useState<HTMLDivElement | null>(null);
    const { open, panel } = state;
    const show = (panel: Panel, event: MouseEvent<HTMLButtonElement>) => {
        const container = event.currentTarget.closest<HTMLElement>('[data-slot="media-player"]');
        if (!container || afterClose.current) return;
        opener.current = event.currentTarget;
        dispatch({ type: "open", panel, container, season: playingEpisode?.season ?? 1 });
    };
    const close = (select?: () => void) => {
        if (!open) return;
        afterClose.current = select ?? null;
        dispatch({ type: "close" });
    };

    return (
        <Drawer open={open} swipeDirection="right" onOpenChange={visible => { if (!visible) close(); }}
            onOpenChangeComplete={visible => {
                if (visible) return;
                const select = afterClose.current;
                afterClose.current = null;
                dispatch({ type: "finish-close" });
                select?.();
            }}>
            {playingEpisode && (
                <MediaPlayerTooltip tooltip="Episodes">
                    <Button type="button" variant="player-control" aria-label="Episodes"
                        aria-haspopup="dialog" aria-expanded={open && panel.view === "episodes"} onClick={event => show("episodes", event)}>
                        <ListVideo aria-hidden="true" />
                    </Button>
                </MediaPlayerTooltip>
            )}
            <MediaPlayerTooltip tooltip="Streams">
                <Button type="button" variant="player-control" aria-label="Streams"
                    aria-haspopup="dialog" aria-expanded={open && panel.view === "streams"} onClick={event => show("streams", event)}>
                    <Layers aria-hidden="true" />
                </Button>
            </MediaPlayerTooltip>
            {panel && (
                <DrawerContent ref={setPopup} container={panel.container} data-player-selection-drawer="" data-player-native-glass=""
                    overlayClassName={`${drawerStyles.overlay} bg-black/25`}
                    className={`${drawerStyles.popup} ${floatingSurface.surface} rounded-2xl border border-border shadow-xl [--drawer-inset:1rem] after:hidden`}
                    initialFocus={false} finalFocus={() => opener.current?.isConnected ? opener.current : panel.container}>
                    <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
                        <DrawerTitle className="text-lg font-semibold">{panel.view === "episodes" ? "Episodes" : "Streams"}</DrawerTitle>
                        <DrawerClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Close" />}>
                            <X aria-hidden="true" />
                        </DrawerClose>
                    </div>
                    {panel.view === "episodes" && playingEpisode && (
                        <PlayerEpisodePicker playing={playingEpisode} season={panel.season} portalContainer={popup}
                            onSeasonChange={season => dispatch({ type: "choose-season", season })}
                            onSelect={episode => {
                                const current = episode.season === playingEpisode.season && episode.episode === playingEpisode.episode;
                                close(current ? undefined : () => onEpisodeSelect(episode));
                            }} />
                    )}
                    {panel.view === "streams" && (
                        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-4">
                            <MediaActions key={media.id} media={media} streamSelection={{ currentUrl: streamUrl, onSelect: stream => {
                                close((stream.url || stream.externalUrl) === streamUrl ? undefined : () => onStreamSelect(stream));
                            } }} />
                        </div>
                    )}
                </DrawerContent>
            )}
        </Drawer>
    );
}

function PlayerEpisodePicker({ playing, season, portalContainer, onSeasonChange, onSelect }: {
    playing: PlayingEpisode; season: number;
    portalContainer: HTMLElement | null;
    onSeasonChange(_season: number): void; onSelect(_episode: Episode): void;
}) {
    const [seasons, setSeasons] = useState<Season[]>([]);
    useEffect(() => {
        let cancelled = false;
        void fetchSeasons(playing.seriesId).then(items => {
            if (!cancelled) setSeasons(items);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [playing.seriesId]);

    const options = seasons.some(item => item.number === playing.season) ? seasons : [...seasons, {
        number: playing.season,
        name: playing.season === 0 ? "Specials" : `Season ${playing.season}`,
        episodeCount: 0,
    }];
    return (
        <>
            <div className="shrink-0 px-4 pb-2">
                <div className="w-48 min-w-0 max-w-full">
                    <Select label="Season" hideLabel className={seasonStyles.seasonTrigger} portalContainer={portalContainer}
                        value={String(season)} onValueChange={value => onSeasonChange(Number(value))} placeholder="Select season"
                        options={options.map(item => ({ value: String(item.number), label: item.name }))} />
                </div>
            </div>
            <EpisodeChoices key={`${playing.seriesId}:${season}`} playing={playing} season={season} onSelect={onSelect} />
        </>
    );
}

function EpisodeChoices({ playing, season, onSelect }: {
    playing: PlayingEpisode; season: number; onSelect(_episode: Episode): void;
}) {
    type Result = { status: "loading" | "error" } | { status: "ready"; episodes: Episode[]; checkedAt: number };
    const [result, setResult] = useState<Result>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const current = useRef<HTMLButtonElement | null>(null);
    const choices = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        let cancelled = false;
        const lease = /^tmdb:[1-9]\d*$/.test(playing.seriesId) ? acquireSeriesSeason(playing.seriesId, season) : undefined;
        const request = lease?.promise ?? fetchEpisodes(playing.seriesId, season, undefined, false);
        void request.then(episodes => {
            if (!cancelled) setResult({ status: "ready", episodes: [...episodes].sort((a, b) => a.episode - b.episode), checkedAt: Date.now() });
        }).catch(() => { if (!cancelled) setResult({ status: "error" }); });
        return () => { cancelled = true; lease?.release(); };
    }, [playing.seriesId, season, attempt]);
    useLayoutEffect(() => {
        if (!choices.current || !current.current) return;
        const panel = choices.current.getBoundingClientRect();
        const row = current.current.getBoundingClientRect();
        if (row.top < panel.top) choices.current.scrollTop += row.top - panel.top;
        else if (row.bottom > panel.bottom) choices.current.scrollTop += row.bottom - panel.bottom;
    }, [result, playing.episode, playing.season]);

    return (
        <div ref={choices} className="@container min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-4">
            {result.status === "loading" && <p role="status" className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" /> Loading episodes
            </p>}
            {result.status === "error" && <div role="alert" className="flex items-center justify-between gap-2 py-5 text-sm">
                Couldn’t load episodes
                <Button type="button" variant="secondary" size="sm" onClick={() => {
                    setResult({ status: "loading" });
                    setAttempt(value => value + 1);
                }}>Retry</Button>
            </div>}
            {result.status === "ready" && (result.episodes.length ? (
                <ul className="space-y-1 py-1">
                    {result.episodes.map(episode => {
                        const selected = episode.season === playing.season && episode.episode === playing.episode;
                        const releasedAt = Date.parse(episode.released ?? "");
                        const upcoming = releasedAt > result.checkedAt;
                        const airDate = episode.released && Number.isFinite(releasedAt) ? formatReleaseDate(episode.released) : undefined;
                        const runtime = formatRuntime(episode.runtime);
                        const metadata = [upcoming && !selected ? "Upcoming" : undefined, runtime, airDate]
                            .filter(Boolean).join(" ·\u00a0");
                        const thumbnail = episodeThumbnailUrl(episode.thumbnail, playing.seriesId, episode.season, episode.episode);
                        return (
                            <li key={episode.id}>
                                <button type="button" ref={selected ? current : undefined} aria-current={selected || undefined}
                                    disabled={upcoming && !selected} onClick={() => onSelect(episode)}
                                    className="flex w-full items-center gap-3 rounded-lg p-1.5 text-start outline-none aria-[current=true]:bg-accent/70 enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                                    <div className={`${artworkStyles.surface} ${cardStyles.card} ${cardStyles.frame} relative grid aspect-video w-[clamp(3.5rem,25cqw,6rem)] shrink-0 place-items-center overflow-hidden bg-muted`}>
                                        {thumbnail ? <ArtworkImage src={thumbnail} alt="" loading="lazy" draggable={false}
                                            className="absolute inset-0 size-full object-cover" />
                                            : <Play aria-hidden="true" className="size-4 text-muted-foreground" />}
                                    </div>
                                    <span className="min-w-0">
                                        <span className="flex items-start gap-1.5 text-sm font-medium">
                                            <span className="min-w-0 wrap-break-word">
                                                <span className="font-normal text-muted-foreground">{episode.episode}.</span>
                                                {"\u00a0"}{episode.title}
                                            </span>
                                            {selected && <Play aria-hidden="true" className="mt-1 size-3 shrink-0 fill-current text-foreground/75" />}
                                        </span>
                                        {metadata && <span className="mt-1 block text-xs text-muted-foreground">{metadata}</span>}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : <p className="py-5 text-sm text-muted-foreground">No episodes available for this season.</p>)}
        </div>
    );
}
