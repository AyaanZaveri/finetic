"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { Layers, ListOrdered, ListVideo, Play, TriangleAlert, X } from "lucide-react";
import { useMediaSelector } from "media-chrome/react/media-store";
import { fetchEpisodes, fetchSeasons, type Episode } from "@/app/actions/tv-shows";
import { ArtworkImage } from "@/components/artwork-image";
import { MediaActions } from "@/components/media-actions";
import { useStreamQueries } from "@/components/stream-query-provider";
import { PlayerChapterChoices, useChapterPreviews, type ChapterNavigation } from "@/components/player-chapter-choices";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import { Button } from "@/components/ui/button";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select } from "@/components/arc/select/select";
import seasonStyles from "@/components/season-episodes.module.css";
import {
    selectionListClass, selectionMetadataText, selectionRowClass, selectionRowLayout,
    selectionThumbnailClass, selectionThumbnailSize, selectionTitleText,
} from "./player-selection-row-styles";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import drawerStyles from "./player-selection-controls.module.css";
import { episodeThumbnailUrl } from "@/lib/artwork";
import { formatReleaseDate } from "@/lib/format-release-date";
import { formatRuntime } from "@/lib/format-runtime";
import { acquireSeriesSeason } from "@/lib/media/series-season";
import { routePrefetchAllowed } from "@/lib/route-prefetch";
import type { MediaItem, StremioStream } from "@/types/stremio";

type Panel = "episodes" | "streams" | "chapters";
const panelTitles: Record<Panel, string> = { episodes: "Episodes", streams: "Streams", chapters: "Chapters" };
type DrawerPanel =
    | { view: "episodes"; container: HTMLElement; season: number }
    | { view: "streams" | "chapters"; container: HTMLElement };
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
            : { view: event.panel, container: event.container } };
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
const episodeQueryDefaults = { staleTime: 5 * 60_000, gcTime: 15 * 60_000, retry: false, refetchOnWindowFocus: false } as const;
const seasonOptions = (seriesId: string) => queryOptions({ ...episodeQueryDefaults,
    queryKey: ["player-drawer", "seasons", seriesId], queryFn: () => fetchSeasons(seriesId),
});
const episodeOptions = (seriesId: string, season: number) => queryOptions({ ...episodeQueryDefaults,
    queryKey: ["player-drawer", "episodes", seriesId, season],
    queryFn: async () => {
        const lease = /^tmdb:[1-9]\d*$/.test(seriesId) ? acquireSeriesSeason(seriesId, season) : undefined;
        try {
            const episodes = await (lease?.promise ?? fetchEpisodes(seriesId, season));
            return [...episodes].sort((a, b) => a.episode - b.episode);
        } finally { lease?.release(); }
    },
});

export function PlayerSelectionControls({ media, streamUrl, playingEpisode, chapterNavigation, playbackReady = false, onEpisodeSelect, onStreamSelect }: {
    media: MediaItem;
    streamUrl: string | null;
    playingEpisode?: PlayingEpisode;
    chapterNavigation?: ChapterNavigation;
    playbackReady?: boolean;
    onEpisodeSelect(_episode: Episode): void;
    onStreamSelect(_stream: StremioStream): void;
}) {
    const queries = useStreamQueries();
    const [workbenchClient] = useState(() => queries ? undefined : new QueryClient());
    const client = queries?.client ?? workbenchClient!;
    const seriesId = playingEpisode?.seriesId;
    const playingSeason = playingEpisode?.season;
    useEffect(() => {
        if (!playbackReady || !seriesId || playingSeason === undefined) return;
        const timer = setTimeout(() => {
            if (!routePrefetchAllowed()) return;
            void client.prefetchQuery(seasonOptions(seriesId));
            void client.prefetchQuery(episodeOptions(seriesId, playingSeason));
        }, 1500);
        return () => clearTimeout(timer);
    }, [client, playbackReady, seriesId, playingSeason]);
    const [state, dispatch] = useReducer(drawerTransition, closed);
    const opener = useRef<HTMLButtonElement | null>(null);
    const returningFocus = useRef<{ button: HTMLButtonElement } | null>(null);
    const afterClose = useRef<(() => void) | null>(null);
    const [popup, setPopup] = useState<HTMLDivElement | null>(null);
    const trackChapters = useMediaSelector(state => state.mediaChaptersCues);
    const availableChapters = chapterNavigation?.chapters.length ? chapterNavigation.chapters : trackChapters ?? [];
    const { open, panel } = state;
    const chapterPreviews = useChapterPreviews(chapterNavigation, availableChapters, open && panel.view === "chapters", playbackReady);
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
    const restoreFocus = (fallback: HTMLElement) => {
        const button = opener.current;
        if (!button?.isConnected) return fallback;
        const target = { button };
        returningFocus.current = target;
        // Base UI restores focus in a microtask. Expire the marker even if it cancels that move.
        setTimeout(() => {
            if (returningFocus.current === target) returningFocus.current = null;
        }, 0);
        return button;
    };
    const onOpenerFocus = (event: FocusEvent<HTMLButtonElement>) => {
        if (returningFocus.current?.button !== event.currentTarget) return;
        returningFocus.current = null;
        // Radix skips opening the tooltip when the trigger's focus event is handled.
        event.preventDefault();
    };

    return (
        <Drawer modal open={open} swipeDirection="right" onOpenChange={visible => { if (!visible) close(); }}
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
                        aria-haspopup="dialog" aria-expanded={open && panel.view === "episodes"} onFocus={onOpenerFocus} onClick={event => show("episodes", event)}>
                        <ListVideo aria-hidden="true" />
                    </Button>
                </MediaPlayerTooltip>
            )}
            <MediaPlayerTooltip tooltip="Streams">
                <Button type="button" variant="player-control" aria-label="Streams"
                    aria-haspopup="dialog" aria-expanded={open && panel.view === "streams"} onFocus={onOpenerFocus} onClick={event => show("streams", event)}>
                    <Layers aria-hidden="true" />
                </Button>
            </MediaPlayerTooltip>
            {panel && (
                <DrawerContent ref={setPopup} container={panel.container} data-player-selection-drawer=""
                    data-player-native-glass=""
                    overlayClassName={`${drawerStyles.overlay} bg-black/25`}
                    className={`${drawerStyles.popup} ${floatingSurface.surface} rounded-2xl border border-border shadow-xl [--drawer-inset:1rem] after:hidden`}
                    initialFocus finalFocus={() => restoreFocus(panel.container)}>
                    <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
                        <DrawerTitle className="text-lg font-semibold">{panelTitles[panel.view]}</DrawerTitle>
                        <DrawerClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Close" />}>
                            <X aria-hidden="true" />
                        </DrawerClose>
                    </div>
                    {panel.view === "episodes" && playingEpisode && (
                        <PlayerEpisodePicker client={client} playing={playingEpisode} season={panel.season} portalContainer={popup}
                            onSeasonChange={season => dispatch({ type: "choose-season", season })}
                            onSelect={episode => {
                                const current = episode.season === playingEpisode.season && episode.episode === playingEpisode.episode;
                                close(current ? undefined : () => onEpisodeSelect(episode));
                            }} />
                    )}
                    {panel.view === "streams" && (
                        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pt-1 pb-4">
                            <MediaActions key={media.id} media={media} streamSelection={{ currentUrl: streamUrl, onSelect: stream => {
                                close((stream.url || stream.externalUrl) === streamUrl ? undefined : () => onStreamSelect(stream));
                            } }} />
                        </div>
                    )}
                    {panel.view === "chapters" && chapterNavigation && (
                        <PlayerChapterChoices key={chapterNavigation.source} {...chapterNavigation} chapters={availableChapters}
                            images={chapterPreviews.images} showFrames={chapterPreviews.showFrames}
                            onSeek={time => close(() => chapterNavigation.onSeek(time))} />
                    )}
                </DrawerContent>
            )}
            {chapterNavigation && availableChapters.length > 0 && (
                <MediaPlayerTooltip tooltip="Chapters">
                    <Button type="button" variant="player-control" aria-label="Chapters"
                        aria-haspopup="dialog" aria-expanded={open && panel.view === "chapters"} onFocus={onOpenerFocus} onClick={event => show("chapters", event)}>
                        <ListOrdered aria-hidden="true" />
                    </Button>
                </MediaPlayerTooltip>
            )}
            {chapterPreviews.decoder}
        </Drawer>
    );
}

function PlayerEpisodePicker({ client, playing, season, portalContainer, onSeasonChange, onSelect }: {
    client: QueryClient;
    playing: PlayingEpisode; season: number;
    portalContainer: HTMLElement | null;
    onSeasonChange(_season: number): void; onSelect(_episode: Episode): void;
}) {
    const { data: seasons = [] } = useQuery(seasonOptions(playing.seriesId), client);

    const options = seasons.some(item => item.number === playing.season) ? seasons : [...seasons, {
        number: playing.season,
        name: playing.season === 0 ? "Specials" : `Season ${playing.season}`,
        episodeCount: 0,
    }];
    return (
        <>
            <div className="shrink-0 px-4 pb-3">
                <div className="w-48 min-w-0 max-w-full">
                    <Select label="Season" hideLabel className={seasonStyles.seasonTrigger} portalContainer={portalContainer}
                        value={String(season)} onValueChange={value => onSeasonChange(Number(value))} placeholder="Select season"
                        options={options.map(item => ({ value: String(item.number), label: item.name }))} />
                </div>
            </div>
            <EpisodeChoices key={`${playing.seriesId}:${season}`} client={client} playing={playing} season={season} onSelect={onSelect} />
        </>
    );
}

function EpisodeChoices({ client, playing, season, onSelect }: {
    client: QueryClient;
    playing: PlayingEpisode; season: number; onSelect(_episode: Episode): void;
}) {
    const { data: episodes, dataUpdatedAt, isFetching, isError, refetch } = useQuery(episodeOptions(playing.seriesId, season), client);
    const hasEpisodes = Boolean(episodes?.length);
    const current = useRef<HTMLButtonElement | null>(null);
    const choices = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        if (!choices.current || !current.current) return;
        const panel = choices.current.getBoundingClientRect();
        const row = current.current.getBoundingClientRect();
        if (row.top < panel.top) choices.current.scrollTop += row.top - panel.top;
        else if (row.bottom > panel.bottom) choices.current.scrollTop += row.bottom - panel.bottom;
    }, [hasEpisodes, playing.episode, playing.season]);

    return (
        <div ref={choices} className="@container min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-4">
            {!episodes && (isFetching || !isError) && (
                <>
                    <p role="status" className="sr-only">Loading episodes</p>
                    <LoadingPlaceholder className={selectionListClass}>
                        {Array.from({ length: 12 }, (_, index) => (
                            <div key={index} className={selectionRowLayout}>
                                <Skeleton className={`${selectionThumbnailSize} rounded-[calc(var(--radius)-2px)]`} />
                                <div className="min-w-0 flex-1">
                                    <div className={`${selectionTitleText} flex h-[1lh] items-center`}>
                                        <Skeleton className="h-3.5 w-3/5 max-w-44" />
                                    </div>
                                    <div className={`${selectionMetadataText} flex h-[1lh] items-center`}>
                                        <Skeleton className="h-3 w-2/5 max-w-28" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </LoadingPlaceholder>
                </>
            )}
            {!episodes && isError && !isFetching && (
                <Empty>
                    <EmptyHeader role="alert">
                        <EmptyMedia variant="icon"><TriangleAlert aria-hidden="true" /></EmptyMedia>
                        <EmptyTitle>Couldn’t load episodes</EmptyTitle>
                    </EmptyHeader>
                    <EmptyContent>
                        <Button type="button" variant="secondary" size="sm" onClick={() => void refetch()}>Retry</Button>
                    </EmptyContent>
                </Empty>
            )}
            {episodes && (episodes.length ? (
                <ul className={selectionListClass}>
                    {episodes.map(episode => {
                        const selected = episode.season === playing.season && episode.episode === playing.episode;
                        const releasedAt = Date.parse(episode.released ?? "");
                        const upcoming = releasedAt > dataUpdatedAt;
                        const airDate = episode.released && Number.isFinite(releasedAt) ? formatReleaseDate(episode.released) : undefined;
                        const runtime = formatRuntime(episode.runtime);
                        const metadata = [upcoming && !selected ? "Upcoming" : undefined, runtime, airDate]
                            .filter(Boolean).join(" ·\u00a0");
                        const thumbnail = episodeThumbnailUrl(episode.thumbnail, playing.seriesId, episode.season, episode.episode);
                        return (
                            <li key={episode.id}>
                                <button type="button" ref={selected ? current : undefined} aria-current={selected || undefined}
                                    disabled={upcoming && !selected} onClick={() => onSelect(episode)}
                                    className={selectionRowClass}>
                                    <div className={selectionThumbnailClass}>
                                        {thumbnail ? <ArtworkImage src={thumbnail} alt="" loading="lazy" draggable={false}
                                            className="absolute inset-0 size-full object-cover" />
                                            : <Play aria-hidden="true" className="size-4 text-muted-foreground" />}
                                    </div>
                                    <span className="min-w-0">
                                        <span className={`${selectionTitleText} block wrap-break-word`}>
                                            <span className="font-normal text-muted-foreground">{episode.episode}.</span>
                                            {"\u00a0"}{episode.title}
                                        </span>
                                        {metadata && <span className={`${selectionMetadataText} block`}>{metadata}</span>}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><ListVideo aria-hidden="true" /></EmptyMedia>
                        <EmptyTitle>No episodes available for this season</EmptyTitle>
                    </EmptyHeader>
                </Empty>
            ))}
        </div>
    );
}
