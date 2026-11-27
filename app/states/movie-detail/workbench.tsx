"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MovieDetailsView, MovieDetailsMessage, SimilarMoviesSection, SimilarMoviesSkeleton } from "@/components/media-page/movie-details-view";
import titleStyles from "@/components/media-page/title-detail.module.css";
import { SeriesDetailsFrame } from "@/components/media-page/series-details-frame";
import { ProductionCompaniesSection } from "@/components/media-page/production-companies-section";
import { MovieCollectionSection } from "@/components/media-page/movie-collection-section";
import { SeriesOverviewView } from "@/components/media-page/series-overview-view";
import { SeasonEpisodes, SeasonEpisodesPlaceholder } from "@/components/season-episodes";
import { SignInForStreams } from "@/components/sign-in-for-streams";
import { MediaDetailsLoading } from "@/components/media-page/loading";
import { CastScrollArea } from "@/components/cast-scrollarea";
import { AppHeader } from "@/components/app-header";
import { JotaiProvider } from "@/components/jotai-provider";
import { AccountProvider } from "@/components/account-provider";
import { WatchHistoryProvider } from "@/contexts/watch-history-context";
import { fixture, accountFixture, seriesFixture } from "./fixtures";
import { streamFixture } from "./stream-fixtures";
import { groups, readState, states, type StateId } from "./states";
import styles from "./states.module.css";

const channel = "navigator-movie-detail-workbench";

function keyboardCommand(event: KeyboardEvent) {
    const target = event.target;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-slot="drawer-popup"]'))) return;
    if (event.key.toLowerCase() === "h") return "hide";
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return "next";
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return "previous";
}

function SeriesStage({ id }: { id: StateId }) {
    const { show, cast, companies, recommendations, regularSeasonCount, episodes } = useMemo(() => seriesFixture(id), [id]);
    const progress = id === "series-resume" ? accountFixture(id).progress : null;
    const selection = progress ? { season: 1, episode: 3 } : { season: 1, episode: 1 };
    return <SeriesDetailsFrame show={show}
        cast={cast.length ? <div className={`${titleStyles.sectionGutter} mt-2 px-4 md:px-10`}><CastScrollArea cast={cast} /></div> : null}
        companies={<ProductionCompaniesSection companies={companies} />}
        recommendations={<SimilarMoviesSection items={recommendations} />}>
        <SeriesOverviewView show={show} regularSeasonCount={regularSeasonCount} previewProgress={progress} />
        <div className="mt-8">
            {id === "series-episodes-loading" ? <SeasonEpisodesPlaceholder /> : <SeasonEpisodes
                showId={show.id}
                initialSeasons={show.seasons}
                prefetchedVideos={episodes}
                prefetchedComplete
                previewPlayback
                hasEpisodeRoute={false}
                currentSeasonNumber={selection.season}
                currentEpisodeNumber={selection.episode}
                progress={progress}
                progressEpisode={progress ? selection : undefined}
            />}
        </div>
        {id === "series-guest" && <div className="mt-6"><SignInForStreams /></div>}
    </SeriesDetailsFrame>;
}

function Stage({ id }: { id: StateId }) {
    const { movie, cast, companies, collection, recommendations } = fixture(id);
    const account = useMemo(() => accountFixture(id), [id]);
    const authenticated = id !== "guest" && id !== "series-guest";
    return <JotaiProvider>
        <AccountProvider authenticated={authenticated}>
            <WatchHistoryProvider key={id} enabled={authenticated} fetchItems={account.fetchItems} saveStatus={account.saveStatus}>
            <div data-app-layout className="relative flex h-dvh flex-col overflow-hidden">
                <div className="relative grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
                    <AppHeader email="viewer@example.invalid" overlay onSignOut={async () => {}} />
                    <main data-page-scroll="" data-header-overlay="true" className="relative z-[1] col-start-1 row-start-1 row-span-2 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain pb-[env(safe-area-inset-bottom)]">
                        {id === "loading" ? <MediaDetailsLoading /> :
                         id === "error" || id === "not-found" ? <MovieDetailsMessage kind={id} /> :
                         id.startsWith("series-") ? <SeriesStage key={id} id={id} /> :
                         <MovieDetailsView key={id} movie={movie} previewProgress={account.progress}
                            previewStreams={streamFixture(id)}
                            cast={cast.length ? <div className={`${titleStyles.sectionGutter} mt-2 px-4 md:px-10`}><CastScrollArea cast={cast} /></div> : null}
                            companies={<ProductionCompaniesSection companies={companies} />}
                            collection={<MovieCollectionSection collection={collection} />}
                            recommendations={id === "recommendations-loading" ? <SimilarMoviesSkeleton /> : <SimilarMoviesSection items={recommendations} />}
                         />}
                    </main>
                </div>
            </div>
            </WatchHistoryProvider>
        </AccountProvider>
    </JotaiProvider>;
}

function StageFrame({ initialState }: { initialState: StateId }) {
    const [id, setId] = useState(initialState);
    const active = useRef(initialState);
    const savedScroll = useRef(0);
    useEffect(() => {
        const preview = id.startsWith("streams-") ? document.querySelector<HTMLElement>("[data-stream-preview]") : null;
        if (preview) {
            preview.scrollIntoView({ block: "center" });
            if (id === "streams-drawer") preview.querySelector<HTMLButtonElement>('[data-slot="drawer-trigger"]')?.click();
        } else {
            document.querySelector("[data-page-scroll]")?.scrollTo(0, savedScroll.current);
        }
    }, [id]);
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.origin === location.origin && event.source === window.parent && event.data?.channel === channel) {
                const next = readState(event.data.state);
                if (next === active.current) return;
                savedScroll.current = document.querySelector("[data-page-scroll]")?.scrollTop ?? 0;
                active.current = next;
                setId(next);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            const command = keyboardCommand(event);
            if (command) {
                event.preventDefault();
                window.parent.postMessage({ channel, command }, location.origin);
            }
        };
        window.addEventListener("message", receive);
        window.addEventListener("keydown", onKey);
        window.parent.postMessage({ channel, ready: true }, location.origin);
        return () => {
            window.removeEventListener("message", receive);
            window.removeEventListener("keydown", onKey);
        };
    }, []);
    return <Stage id={id} />;
}

function Switcher({ active, desktop }: { active: StateId; desktop: boolean }) {
    const [initialState] = useState(active);
    const [hidden, setHidden] = useState(false);
    const nav = useRef<HTMLElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const choose = (id: StateId) => {
        const url = new URL(location.href);
        url.searchParams.set("__state", id);
        history.pushState(null, "", url);
    };

    useEffect(() => {
        const send = () => frame.current?.contentWindow?.postMessage({ channel, state: active }, location.origin);
        const command = (value: string) => {
            if (value === "hide") { setHidden(previous => !previous); return; }
            if (value !== "next" && value !== "previous") return;
            const current = states.findIndex(state => state.id === active);
            choose(states[(current + (value === "next" ? 1 : -1) + states.length) % states.length].id);
        };
        const receive = (event: MessageEvent) => {
            if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
            if (event.data.ready) send();
            else command(event.data.command);
        };
        const onKey = (event: KeyboardEvent) => {
            const value = keyboardCommand(event);
            if (value) { event.preventDefault(); command(value); }
        };
        send();
        window.addEventListener("message", receive);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("message", receive);
            window.removeEventListener("keydown", onKey);
        };
    }, [active]);

    useEffect(() => {
        const list = nav.current;
        const button = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!list || !button) return;
        const top = button.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + button.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + button.offsetHeight - list.clientHeight;
    }, [active, hidden]);

    return <div className={styles.page} data-switcher-hidden={hidden || undefined} data-desktop-preview={desktop || undefined}>
        <div className={styles.layout}>
            <nav ref={nav} className={styles.switcher} aria-label="States">
                {groups.map(group => <div key={group.title} role="group" aria-labelledby={`states-${group.title}`} className={styles.group}>
                    <span id={`states-${group.title}`} className={styles.heading}><CornerDownRight size={12} />{group.title}</span>
                    {group.states.map(state => <button key={state.id} type="button" aria-pressed={active === state.id}
                        onClick={() => choose(state.id)}>{state.label}</button>)}
                </div>)}
            </nav>
            <div className={styles.toolbar}>
            <div className={styles.select}>
                <select aria-label="State" value={active} onChange={event => choose(readState(event.target.value))}>
                    {groups.map(group => <optgroup key={group.title} label={group.title}>
                        {group.states.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}
                    </optgroup>)}
                </select>
                <ChevronDown aria-hidden="true" size={12} />
            </div>
            <Button type="button" variant="outline" size="sm" aria-pressed={desktop}
                aria-controls="movie-detail-preview" onClick={() => {
                    const url = new URL(location.href);
                    if (desktop) url.searchParams.delete("__view");
                    else url.searchParams.set("__view", "desktop");
                    history.pushState(null, "", url);
                }}>
                {desktop ? <Minimize2 className="size-3.5 text-muted-foreground" aria-hidden="true" /> : <Maximize2 className="size-3.5 text-muted-foreground" aria-hidden="true" />}
                {desktop ? "Exit desktop view" : "Desktop view"}
            </Button>
            </div>
            <iframe id="movie-detail-preview" ref={frame} src={`/states/movie-detail?__stage=1&__state=${initialState}`} className={styles.frame}
                title="Movie and TV show detail workbench" />
        </div>
    </div>;
}

function Workbench() {
    const params = useSearchParams();
    const active = readState(params.get("__state"));
    return params.get("__stage") === "1" ? <StageFrame initialState={active} /> : <Switcher active={active} desktop={params.get("__view") === "desktop"} />;
}

export default function MovieDetailWorkbench() {
    return <Suspense><Workbench /></Suspense>;
}
