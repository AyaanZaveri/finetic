"use client";

import { ChevronDown, CornerDownRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SettingsShell } from "@/components/settings/settings-shell";
import { SettingsView } from "@/components/settings/settings-view";
import { AppUpdateProvider } from "@/components/desktop/app-update-provider";
import { SettingsProvider } from "@/contexts/settings-context";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "@/lib/settings-navigation";
import { installFixtures } from "./fixtures";
import { groups, isReleaseNotesState, readState, settingsStateHref, states, type StateId } from "./states";
import styles from "./states.module.css";

const channel = "navigator-settings-workbench";
type Command = "next" | "previous" | "hide";

function commandFor(event: KeyboardEvent): Command | undefined {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    if (event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable], [role=combobox], [role=listbox], [role=menu]")) return;
    if (event.key.toLowerCase() === "h") return "hide";
    if (event.target instanceof Element && event.target.closest("[role=dialog]")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return "next";
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return "previous";
}

function stageHref(id: StateId, scrollTop = 0) {
    return `${settingsStateHref(id)}&__stage=1${scrollTop > 0 ? `&__scroll=${scrollTop}` : ""}`;
}

function Stage({ active, scrollTop }: { active: ReturnType<typeof readState>; scrollTop: number }) {
    const [ready, setReady] = useState(false);
    const [error, setError] = useState(false);
    const stage = useRef<HTMLElement>(null);
    const { id, category } = active;

    useEffect(() => {
        let fixtures: ReturnType<typeof installFixtures> | undefined;
        let mounted = true;
        const setup = window.setTimeout(() => {
            fixtures = installFixtures(id);
            void fixtures.ready.then(
                () => { if (mounted) setReady(true); },
                () => { if (mounted) setError(true); },
            );
        }, 0);
        const onKey = (event: KeyboardEvent) => {
            const command = commandFor(event);
            if (!command) return;
            event.preventDefault();
            window.parent.postMessage({ channel, command }, location.origin);
        };
        window.addEventListener("keydown", onKey);
        return () => {
            mounted = false;
            window.clearTimeout(setup);
            fixtures?.cleanup();
            window.removeEventListener("keydown", onKey);
        };
    }, [id]);

    useEffect(() => {
        if (!ready) return;
        if (scrollTop > 0) stage.current?.scrollTo({ top: scrollTop, behavior: "instant" });
        else if (id.startsWith("playback-mediaflow-")) {
            stage.current?.querySelector("#playback-mediaflow")?.scrollIntoView({ block: "start", behavior: "instant" });
        } else if (id.startsWith("connections-mdblist-")) {
            stage.current?.querySelector("#mdblist")?.scrollIntoView({ block: "start", behavior: "instant" });
        }
    }, [ready, scrollTop, id]);

    useEffect(() => {
        if (!ready) return;
        const panel = stage.current;
        const mdb = id.startsWith("connections-mdblist-");
        const form = panel?.querySelector<HTMLInputElement>(mdb ? "#mdblist-api-key" : "#tmdb-read-access-token")?.form;
        const autoSave = id === "connections-saving" || id === "connections-save-error" || ["connections-mdblist-saving", "connections-mdblist-save-error", "connections-mdblist-saved"].includes(id);
        const autoRemove = id === "connections-mdblist-removing" || id === "connections-mdblist-removed";
        const autoSignIn = id === "navigator-chatgpt-pending" || id === "navigator-chatgpt-error";
        const autoReleaseNotes = isReleaseNotesState(id);
        if (!panel || (!autoSave && !autoRemove && !autoSignIn && !autoReleaseNotes)) return;
        const buttonLabel = autoReleaseNotes ? "Release notes" : "Continue with ChatGPT";
        const run = () => {
            const button = autoSave ? form?.querySelector<HTMLButtonElement>("button[type=submit]")
                : autoRemove ? Array.from(form?.querySelectorAll("button") ?? []).find(button => button.textContent?.includes("Remove key"))
                : Array.from(panel.querySelectorAll("button")).find(button => button.textContent?.includes(buttonLabel));
            if (!button || button.disabled) return;
            observer.disconnect();
            if (autoSave) form?.requestSubmit(button);
            else button.click();
        };
        const observer = new MutationObserver(run);
        observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
        run();
        return () => observer.disconnect();
    }, [id, ready]);

    if (error) return <p role="alert">Couldn’t load the settings fixture.</p>;
    if (!ready) return null;

    const defaultState = (category: SettingsCategory) => groups[category][0][0];
    const select = (id: StateId) => {
        if (id === active.id) return;
        if (window.parent === window) window.location.replace(stageHref(id));
        else window.parent.postMessage({ channel, state: id }, location.origin);
    };
    return <main ref={stage} className={styles.stage} data-page-scroll="" onClickCapture={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const link = event.target instanceof Element ? event.target.closest("a[href='/settings/connections']") : null;
        if (!link) return;
        event.preventDefault();
        select("connections-unconfigured");
    }}>
        <AppUpdateProvider>
            <SettingsProvider>
                <SettingsShell navigation={{
                    category,
                    href: category => stageHref(defaultState(category)),
                    select: category => { if (category !== active.category) select(defaultState(category)); },
                }}>
                    <SettingsView category={category} />
                </SettingsShell>
            </SettingsProvider>
        </AppUpdateProvider>
    </main>;
}

function Switcher({ active }: { active: ReturnType<typeof readState> }) {
    const [hidden, setHidden] = useState(false);
    const [initialState] = useState(active.id);
    const nav = useRef<HTMLElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const displayed = useRef(active.id);
    useEffect(() => {
        if (displayed.current === active.id) return;
        const stage = frame.current?.contentDocument?.querySelector<HTMLElement>("[data-page-scroll]");
        const scrollTop = readState(displayed.current).category === active.category && !active.id.startsWith("connections-mdblist-") ? stage?.scrollTop : 0;
        displayed.current = active.id;
        frame.current?.contentWindow?.location.replace(stageHref(active.id, scrollTop));
    }, [active.id, active.category]);

    useEffect(() => {
        const choose = (id: StateId) => { if (id !== active.id) history.pushState(null, "", settingsStateHref(id)); };
        const run = (command: Command) => {
            if (command === "hide") {
                setHidden(value => !value);
                return;
            }
            const index = states.indexOf(active);
            const direction = command === "next" ? 1 : -1;
            choose(states[(index + direction + states.length) % states.length].id);
        };
        const onKey = (event: KeyboardEvent) => {
            const command = commandFor(event);
            if (!command) return;
            event.preventDefault();
            run(command);
        };
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
            if (event.data.command === "next" || event.data.command === "previous" || event.data.command === "hide") run(event.data.command);
            const state = states.find(state => state.id === event.data.state);
            if (state) choose(state.id);
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("message", onMessage);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("message", onMessage);
        };
    }, [active]);

    useEffect(() => {
        const list = nav.current;
        const button = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (!list || !button || !list.clientHeight) return;
        const top = button.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + button.offsetHeight > list.scrollTop + list.clientHeight) {
            list.scrollTop = top + button.offsetHeight - list.clientHeight;
        }
    }, [active, hidden]);

    return <div className={styles.page} data-switcher-hidden={hidden || undefined}>
        <div className={styles.layout}>
            <nav ref={nav} className={styles.switcher} aria-label="Settings states">
                {SETTINGS_CATEGORIES.map(({ id, label }) => <div key={id} role="group" aria-labelledby={`states-${id}`} className={styles.group}>
                    <span id={`states-${id}`} className={styles.heading}><CornerDownRight size={12} aria-hidden="true" />{label}</span>
                    {groups[id].map(([id, label]) => <button key={id} type="button" data-state={id} aria-pressed={active.id === id}
                        onClick={() => history.pushState(null, "", settingsStateHref(id))}>{label}</button>)}
                </div>)}
            </nav>
            <div className={styles.select}>
                <select aria-label="Settings state" value={active.id} onChange={event => history.pushState(null, "", settingsStateHref(readState(event.target.value).id))}>
                    {SETTINGS_CATEGORIES.map(({ id, label }) => <optgroup key={id} label={label}>
                        {groups[id].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </optgroup>)}
                </select>
                <ChevronDown aria-hidden="true" size={12} />
            </div>
            <iframe ref={frame} title="Navigator Settings" src={stageHref(initialState)} className={styles.frame} />
        </div>
    </div>;
}

export function SettingsWorkbench() {
    const params = useSearchParams();
    const active = readState(params.get("__state"));
    return params.get("__stage") === "1"
        ? <Stage key={active.id} active={active} scrollTop={Number(params.get("__scroll"))} />
        : <Switcher active={active} />;
}
