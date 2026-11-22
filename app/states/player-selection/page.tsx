"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight, Loader2 } from "lucide-react";
import { BrowserPlayerGlass } from "@/components/browser-player-glass";
import { PlayerSelectionControls } from "@/components/player-selection-controls";
import { PlayerControlBar } from "@/components/player-control-bar";
import { PlayerLoadingStatus } from "@/components/player-loading-status";
import { PlayerEndTime, PlayerSubtitleLayer } from "@/components/player-clock-islands";
import { PlayerNextEpisode, PlayerUpNext } from "@/components/player-next-episode";
import { PlayerPlaybackStats } from "@/components/player-playback-stats";
import { PlayerSubtitles } from "@/components/player-subtitles";
import { PlayerVideoFit } from "@/components/player-video-fit";
import { SubtitleTimingPopover } from "@/components/subtitle-timing-popover";
import { MediaPlayer, MediaPlayerFullscreen, MediaPlayerPiP, MediaPlayerSettings, MediaPlayerVideo } from "@/components/ui/media-player";
import { AccountContext } from "@/contexts/account-context";
import { stepSubtitleSize, type SubtitleSize } from "@/lib/subtitle-appearance";
import type { Episode } from "@/app/actions/tv-shows";
import "@/components/player-mobile.css";
import { fixtures, groups, installFixtureFetch, panelFor, readState, states, type StateId } from "./fixtures";
import styles from "./states.module.css";

const channel = "navigator-player-selection-workbench";
const sample = "/images/player-workbench-preview.mp4";
const sampleSubtitle = { text: "The mountains are quiet tonight.", positionTop: false };
const subtitleAt = (time: number) => time >= 4 && time < 30 ? sampleSubtitle : null;
const sampleChapters = [
    { startTime: 0, endTime: 8, text: "Opening" },
    { startTime: 8, endTime: 19, text: "Into the mountains" },
    { startTime: 19, endTime: 29, text: "The ridge" },
    { startTime: 29, endTime: 36, text: "Last light" },
];

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
    const [duration, setDuration] = useState(0);
    const [statsOpen, setStatsOpen] = useState(false);
    const [captions, setCaptions] = useState(false);
    const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>("standard");
    const [timingOpen, setTimingOpen] = useState(false);
    const [delay, setDelay] = useState(0);
    const [upNextOpen, setUpNextOpen] = useState(id === "up-next");
    const stage = useRef<HTMLDivElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const movie = id === "movie";

    useEffect(() => installFixtureFetch(id, data), [id, data]);

    useEffect(() => {
        const panel = panelFor(id);
        if (panel) stage.current?.querySelector<HTMLButtonElement>(`[data-player-toolbar] [aria-label="${panel}"]`)?.click();
    }, [id]);

    const episodeTitle = data.episodes(episode.season).find(item => item.episode === episode.episode)?.title ?? "The Golden Child";
    const title = movie ? "Palm Springs" : episodeTitle;
    const next = data.episodes(episode.season).find(item => item.episode > episode.episode) ?? null;
    const selectEpisode = (item: Episode) => {
        if (video.current) video.current.currentTime = 0;
        setEpisode({ seriesId: data.seriesId, season: item.season, episode: item.episode });
        setUpNextOpen(false);
    };
    return <div ref={stage} data-player-shell="" className="h-dvh w-full bg-black">
        <MediaPlayer autoHide={id === "playing"} className="size-full" chapters={sampleChapters}
            onToggleCaptions={() => setCaptions(value => !value)}
            onAdjustSubtitleSize={direction => setSubtitleSize(size => stepSubtitleSize(size, direction))}>
            <MediaPlayerVideo ref={video} src={sample} poster="/images/subtitle-preview.jpg"
                playsInline preload="auto" className="size-full bg-black"
                autoPlay={id === "playing"} muted={id === "playing"} loop={id === "playing"}
                onLoadedMetadata={event => {
                    const element = event.currentTarget;
                    setDuration(element.duration);
                    element.currentTime = Math.min(9, element.duration / 3);
                }} />
            <BrowserPlayerGlass mediaRef={video} sourceKey={sample} ready={duration > 0} />
            {data.trackLoadingLabel && (
                <div className="pointer-events-none fixed right-4 top-4 z-50 h-9 bg-black/50 backdrop-blur-sm rounded-full px-3 text-white text-sm flex items-center gap-2">
                    <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                    <PlayerLoadingStatus label={data.trackLoadingLabel} />
                </div>
            )}
            <PlayerSubtitleLayer mediaRef={video} lookup={subtitleAt} delay={delay} native={false} enabled={captions}
                size={subtitleSize} position={12} />
            <SubtitleTimingPopover container={video.current?.closest<HTMLElement>('[data-slot="media-player"]')}
                open={timingOpen} onOpenChange={setTimingOpen} seconds={delay} onChange={setDelay} available={captions} />
            <PlayerPlaybackStats open={statsOpen} videoRef={video} onClose={() => setStatsOpen(false)} />
            {upNextOpen && next && <PlayerUpNext next={next} thumbnail={next.thumbnail} seconds={5} timerRunning={false}
                onPlay={() => selectEpisode(next)} onCancel={() => setUpNextOpen(false)} />}
            <PlayerControlBar title={title} previewSource={sample}
                episode={movie ? undefined : { showTitle: "Brooklyn Nine-Nine", season: episode.season, episodeNumber: episode.episode }}
                releaseYear={movie ? 2020 : undefined}
                endTime={<PlayerEndTime duration={duration} mediaRef={video} />}
                nextEpisode={!movie && <PlayerNextEpisode next={next} advancing={false} onAdvance={() => { if (next) selectEpisode(next); }} />}>
                <AccountContext.Provider value={{ authenticated: id !== "stream-signed-out", requestSignIn() {} }}>
                    <PlayerSelectionControls
                        media={{
                            id: movie ? "tt9484998" : `${episode.seriesId}:${episode.season}:${episode.episode}`,
                            type: movie ? "movie" : "series", name: title,
                        }}
                        streamUrl={source} playingEpisode={movie ? undefined : episode}
                        chapterNavigation={{ chapters: sampleChapters, media: video.current, source: sample, onSeek: time => {
                            if (video.current) video.current.currentTime = time;
                        } }}
                        onEpisodeSelect={selectEpisode}
                        onStreamSelect={stream => { const url = stream.url || stream.externalUrl; if (url) setSource(url); }} />
                </AccountContext.Provider>
                <PlayerSubtitles mediaRef={video} sourceKey={sample} native={false}
                    tracks={[{ src: "workbench-captions", label: "English", language: "en", active: captions }]}
                    onTrackChange={track => setCaptions(Boolean(track))}
                    timing={{ seconds: delay, open: timingOpen, onOpen: () => setTimingOpen(true), onClose: () => setTimingOpen(false) }} />
                <PlayerVideoFit mediaRef={video} sourceKey={sample} />
                <MediaPlayerSettings stats={{ open: statsOpen, onOpenChange: setStatsOpen }} />
                <MediaPlayerPiP />
                <MediaPlayerFullscreen />
            </PlayerControlBar>
        </MediaPlayer>
    </div>;
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
            if (command && (command === "hide" || !(event.target instanceof Element && event.target.closest('[data-slot="media-player"]')))) {
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
                title="Navigator player workbench" allow="fullscreen; picture-in-picture" allowFullScreen />
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
