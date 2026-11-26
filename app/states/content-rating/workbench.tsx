"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { MovieDetailsView } from "@/components/media-page/movie-details-view";
import { SeriesDetailsFrame } from "@/components/media-page/series-details-frame";
import { SeriesOverviewView } from "@/components/media-page/series-overview-view";
import { EpisodeDetailsView } from "@/components/media-page/episode-details-view";
import { EpisodeHeroThumbnail } from "@/components/episode-hero-thumbnail";
import { EpisodeDescription } from "@/components/episode-description";
import { MediaPlayButton } from "@/components/media-page/play-button";
import { AppHeader } from "@/components/app-header";
import { JotaiProvider } from "@/components/jotai-provider";
import { AccountProvider } from "@/components/account-provider";
import { WatchHistoryProvider } from "@/contexts/watch-history-context";
import { episode, fixture, groups, readState, states, watchHistoryFixture, type StateId } from "./fixtures";
import styles from "./states.module.css";

const channel = "navigator-content-rating-workbench";

function keyboardCommand(event: KeyboardEvent) {
    const target = event.target;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
    if (event.key.toLowerCase() === "h") return "hide";
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return "next";
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return "previous";
}

function Detail({ id }: { id: StateId }) {
    const title = fixture(id);
    if (title.type === "movie") return <MovieDetailsView movie={title} previewProgress={null} />;
    return <SeriesDetailsFrame show={title}>
        {id.startsWith("episode-") ? <EpisodeDetailsView
            titleId="episode-title"
            showName={title.name}
            title={episode.title ?? ""}
            seasonNumber={1}
            episodeNumber={1}
            released={episode.released}
            ratingMedia={title}
            thumbnail={<EpisodeHeroThumbnail thumbnail={episode.thumbnail} released={episode.released} title={episode.title ?? ""} />}
            actions={<MediaPlayButton previewProgress={null} media={{
                id: title.id, type: "series", name: episode.title ?? "", showName: title.name,
                seriesId: title.id, mediaSourceId: episode.id, episodeTitle: episode.title, seasonNumber: 1, episodeNumber: 1,
            }} />}
            description={episode.overview ? <EpisodeDescription text={episode.overview} /> : undefined}
        /> : <SeriesOverviewView show={title} regularSeasonCount={1} previewProgress={null} />}
    </SeriesDetailsFrame>;
}

function Stage({ initialState }: { initialState: StateId }) {
    const [id, setId] = useState(initialState);
    const account = useMemo(watchHistoryFixture, []);
    const scroll = useRef<HTMLElement>(null);
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.origin === location.origin && event.source === window.parent && event.data?.channel === channel) {
                setId(readState(event.data.state));
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
    return <JotaiProvider>
        <AccountProvider authenticated>
            <WatchHistoryProvider fetchItems={account.fetchItems} saveStatus={account.saveStatus}>
                <div data-app-layout className="relative flex h-dvh flex-col overflow-hidden">
                    <div className="relative grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
                        <AppHeader email="viewer@example.invalid" overlay onSignOut={async () => {}} />
                        <main ref={scroll} data-page-scroll="" data-header-overlay="true" data-rating-state={id}
                            className="relative z-[1] col-start-1 row-start-1 row-span-2 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain pb-[env(safe-area-inset-bottom)]">
                            <Detail id={id} />
                        </main>
                    </div>
                </div>
            </WatchHistoryProvider>
        </AccountProvider>
    </JotaiProvider>;
}

function Switcher({ active }: { active: StateId }) {
    const [initialState] = useState(active);
    const [hidden, setHidden] = useState(false);
    const nav = useRef<HTMLElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const selectState = useCallback((id: StateId) => {
        const url = new URL(location.href);
        url.searchParams.set("__state", id);
        history.pushState(null, "", url);
    }, []);

    useEffect(() => {
        const send = () => frame.current?.contentWindow?.postMessage({ channel, state: active }, location.origin);
        const command = (value: string) => {
            if (value === "hide") { setHidden(previous => !previous); return; }
            if (value !== "next" && value !== "previous") return;
            const index = states.findIndex(state => state.id === active);
            selectState(states[(index + (value === "next" ? 1 : -1) + states.length) % states.length].id);
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
    }, [active, selectState]);

    useEffect(() => {
        const list = nav.current;
        const button = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!list || !button) return;
        const top = button.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + button.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + button.offsetHeight - list.clientHeight;
    }, [active, hidden]);

    return <div className={styles.page} data-switcher-hidden={hidden || undefined}>
        <div className={styles.layout}>
            <nav ref={nav} className={styles.switcher} aria-label="States">
                {groups.map(group => <div key={group.id} role="group" aria-labelledby={`states-${group.id}`} className={styles.group}>
                    <span id={`states-${group.id}`} className={styles.heading}><CornerDownRight aria-hidden="true" size={12} />{group.title}</span>
                    {group.states.map(state => <button key={state.id} type="button" data-state={state.id} aria-pressed={active === state.id}
                        onClick={() => selectState(state.id)}>{state.label}</button>)}
                </div>)}
            </nav>
            <div className={styles.select}>
                <select aria-label="State" value={active} onChange={event => selectState(readState(event.target.value))}>
                    {groups.map(group => <optgroup key={group.id} label={group.title}>
                        {group.states.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}
                    </optgroup>)}
                </select>
                <ChevronDown aria-hidden="true" size={12} />
            </div>
            <iframe ref={frame} src={`/states/content-rating?__stage=1&__state=${initialState}`} className={styles.frame}
                title="Age rating in production title details" />
        </div>
    </div>;
}

function Workbench() {
    const params = useSearchParams();
    const active = readState(params.get("__state"));
    return params.get("__stage") === "1" ? <Stage initialState={active} /> : <Switcher active={active} />;
}

export default function ContentRatingWorkbench() {
    return <Suspense><Workbench /></Suspense>;
}
