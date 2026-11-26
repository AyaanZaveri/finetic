"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { AccountProvider } from "@/components/account-provider";
import { AppHeader } from "@/components/app-header";
import { AuroraProvider, PersistentAuroraBackground } from "@/components/aurora-provider";
import { HomeHero } from "@/components/home-hero";
import { HomeAuroraController } from "@/components/home-aurora-controller";
import { HomePaletteProvider } from "@/components/home-palette-provider";
import { JotaiProvider } from "@/components/jotai-provider";
import { MediaSection } from "@/components/media-section";
import { WatchHistoryProvider } from "@/contexts/watch-history-context";
import homeStyles from "@/app/(main)/home-page.module.css";
import { heroFixture, resolveWorkbenchCatalogs, type HomeHeroPublicData } from "./fixtures";
import { groups, readState, states, type StateId } from "./states";
import styles from "./states.module.css";

const channel = "navigator-home-hero-workbench";

function keyboardCommand(event: KeyboardEvent) {
    const target = event.target;
    if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (target instanceof Element &&
            target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
    ) {
        return;
    }
    if (event.key.toLowerCase() === "h") return "hide";
    if (
        target instanceof Element &&
        target.closest('[aria-label="Featured title switcher"]') &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
        return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return "next";
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return "previous";
}

function Stage({ id, publicData }: { id: StateId; publicData: HomeHeroPublicData }) {
    const { items, authenticated } = useMemo(() => heroFixture(id, publicData), [id, publicData]);
    const { sections, continueWatching } = useMemo(() => resolveWorkbenchCatalogs(publicData), [publicData]);

    return (
        <JotaiProvider>
            <AccountProvider authenticated={authenticated}>
                <WatchHistoryProvider
                    key={id}
                    enabled={authenticated}
                    fetchItems={async () => ({})}
                    saveStatus={async ({ watched }) => ({ movieWatched: watched, watchedEpisodeIds: [] })}
                >
                    <HomePaletteProvider><AuroraProvider>
                        <div data-app-layout data-home-layout="" className="relative flex h-dvh flex-col overflow-hidden">
                            <div className="relative grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
                                <AppHeader email="viewer@example.invalid" home onSignOut={async () => {}} />
                                <main
                                    data-page-scroll=""
                                    data-header-overlay="true"
                                    className="relative z-[1] col-start-1 row-start-1 row-span-2 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain pb-[env(safe-area-inset-bottom)]"
                                >
                                    <PersistentAuroraBackground homePreview />
                                    <HomeAuroraController />
                                    <div data-home-page className={homeStyles.page}>
                                        <h1 className="sr-only">Home</h1>
                                        <HomeHero key={id} items={items} />
                                        <div className={homeStyles.rows}>
                                            {authenticated && (
                                                <MediaSection
                                                    sectionName="Continue Watching"
                                                    mediaItems={continueWatching}
                                                    continueWatching
                                                    revealArtwork={false}
                                                />
                                            )}
                                            {sections.map(section => (
                                                <MediaSection
                                                    key={section.key}
                                                    sectionName={section.sectionName}
                                                    mediaItems={section.mediaItems}
                                                    revealArtwork={false}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </main>
                            </div>
                        </div>
                    </AuroraProvider></HomePaletteProvider>
                </WatchHistoryProvider>
            </AccountProvider>
        </JotaiProvider>
    );
}

function StageFrame({ initialState, publicData }: { initialState: StateId; publicData: HomeHeroPublicData }) {
    const [id, setId] = useState(initialState);
    const active = useRef(initialState);
    const savedScroll = useRef(0);

    useEffect(() => {
        document.querySelector("[data-page-scroll]")?.scrollTo(0, savedScroll.current);
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

    return <Stage id={id} publicData={publicData} />;
}

function Switcher({ active }: { active: StateId }) {
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
            if (value === "hide") {
                setHidden(previous => !previous);
                return;
            }
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
            if (value) {
                event.preventDefault();
                command(value);
            }
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
        else if (top + button.offsetHeight > list.scrollTop + list.clientHeight) {
            list.scrollTop = top + button.offsetHeight - list.clientHeight;
        }
    }, [active, hidden]);

    return (
        <div className={styles.page} data-switcher-hidden={hidden || undefined}>
            <div className={styles.layout}>
                <nav ref={nav} className={styles.switcher} aria-label="States">
                    {groups.map(group => (
                        <div key={group.title} role="group" aria-labelledby={`states-${group.title}`} className={styles.group}>
                            <span id={`states-${group.title}`} className={styles.heading}>
                                <CornerDownRight size={12} aria-hidden="true" />
                                {group.title}
                            </span>
                            {group.states.map(state => (
                                <button
                                    key={state.id}
                                    type="button"
                                    data-state={state.id}
                                    aria-pressed={active === state.id}
                                    onClick={() => choose(state.id)}
                                >
                                    {state.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>

                <div className={styles.select}>
                    <select aria-label="State" value={active} onChange={event => choose(readState(event.target.value))}>
                        {groups.map(group => (
                            <optgroup key={group.title} label={group.title}>
                                {group.states.map(state => (
                                    <option key={state.id} value={state.id}>
                                        {state.label}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                    <ChevronDown aria-hidden="true" size={12} />
                </div>

                <iframe
                    ref={frame}
                    src={`/states/home-hero?__stage=1&__state=${initialState}`}
                    className={styles.frame}
                    title="Home hero workbench"
                />
            </div>
        </div>
    );
}

function Workbench({ publicData }: { publicData: HomeHeroPublicData }) {
    const params = useSearchParams();
    const active = readState(params.get("__state"));
    return params.get("__stage") === "1"
        ? <StageFrame initialState={active} publicData={publicData} />
        : <Switcher active={active} />;
}

export default function HomeHeroWorkbench({ publicData }: { publicData: HomeHeroPublicData }) {
    return (
        <Suspense>
            <Workbench publicData={publicData} />
        </Suspense>
    );
}
