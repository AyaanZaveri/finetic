"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { PlayerSelectionControls } from "@/components/player-selection-controls";
import { MediaPlayer } from "@/components/ui/media-player";
import { AccountContext } from "@/contexts/account-context";
import "@/components/player-mobile.css";
import { fixtures, groups, installFixtureFetch, panelFor, readState, states, type StateId } from "./fixtures";
import styles from "./states.module.css";

const channel = "navigator-player-selection-workbench";

function keyboardCommand(event: KeyboardEvent) {
    const target = event.target;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
    if (event.key.toLowerCase() === "h") return "hide";
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return "next";
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return "previous";
}

function Stage({ id }: { id: StateId }) {
    const [data] = useState(() => fixtures(id));
    const [episode, setEpisode] = useState({
        seriesId: data.seriesId, season: data.currentSeason, episode: data.currentEpisode,
    });
    const [source, setSource] = useState(data.currentStream);
    const toolbar = useRef<HTMLDivElement>(null);
    const movie = id === "movie";

    useEffect(() => installFixtureFetch(id, data), [id, data]);

    useEffect(() => {
        const panel = panelFor(id);
        if (panel) toolbar.current?.querySelector<HTMLButtonElement>(`[aria-label="${panel}"]`)?.click();
    }, [id]);

    const episodeTitle = data.episodes(episode.season).find(item => item.episode === episode.episode)?.title ?? "The Golden Child";
    const title = movie ? "Palm Springs" : episodeTitle;
    return <MediaPlayer autoHide={false} className="relative h-dvh w-full justify-end object-contain">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-75"
            style={{ backgroundImage: "url('/images/subtitle-preview.jpg')" }} />
        <div className="relative flex items-end justify-between gap-4 bg-linear-to-t from-black/85 to-transparent p-6 text-white">
            <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold">{title}</h1>
                {!movie && <p className="text-sm text-white/70">Brooklyn Nine-Nine · S{episode.season} · E{episode.episode}</p>}
            </div>
            <div ref={toolbar} data-player-toolbar="" className="flex shrink-0 items-center gap-2">
                <AccountContext.Provider value={{ authenticated: id !== "stream-signed-out", requestSignIn() {} }}>
                    <PlayerSelectionControls
                        media={{
                            id: movie ? "tt9484998" : `${episode.seriesId}:${episode.season}:${episode.episode}`,
                            type: movie ? "movie" : "series", name: title,
                        }}
                        streamUrl={source} playingEpisode={movie ? undefined : episode}
                        onEpisodeSelect={item => setEpisode({ seriesId: data.seriesId, season: item.season, episode: item.episode })}
                        onStreamSelect={stream => { const url = stream.url || stream.externalUrl; if (url) setSource(url); }} />
                </AccountContext.Provider>
            </div>
        </div>
    </MediaPlayer>;
}

function StageFrame({ initialState }: { initialState: StateId }) {
    const [id, setId] = useState(initialState);
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
    return <Stage key={id} id={id} />;
}

function Switcher({ active }: { active: StateId }) {
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

    return <div className={styles.page} data-switcher-hidden={hidden || undefined}>
        <div className={styles.layout}>
            <nav ref={nav} className={styles.switcher} aria-label="States">
                {groups.map(group => <div key={group.title} role="group" aria-labelledby={`states-${group.title}`} className={styles.group}>
                    <span id={`states-${group.title}`} className={styles.heading}><CornerDownRight size={12} />{group.title}</span>
                    {group.states.map(state => <button key={state.id} type="button" aria-pressed={active === state.id}
                        onClick={() => choose(state.id)}>{state.label}</button>)}
                </div>)}
            </nav>
            <div className={styles.select}>
                <select aria-label="State" value={active} onChange={event => choose(readState(event.target.value))}>
                    {groups.map(group => <optgroup key={group.title} label={group.title}>
                        {group.states.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}
                    </optgroup>)}
                </select>
                <ChevronDown aria-hidden="true" size={12} />
            </div>
            <iframe ref={frame} src="/states/player-selection?__stage=1" className={styles.frame}
                title="Player episode and stream selector" allowFullScreen />
        </div>
    </div>;
}

function Workbench() {
    const params = useSearchParams();
    const active = readState(params.get("__state"));
    return params.get("__stage") === "1" ? <StageFrame initialState={active} /> : <Switcher active={active} />;
}

export default function PlayerSelectionStates() {
    return <Suspense><Workbench /></Suspense>;
}
