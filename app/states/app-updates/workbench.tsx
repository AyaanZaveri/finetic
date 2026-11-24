"use client";

import { ChevronDown, CornerDownRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppUpdates } from "@/components/settings/app-updates";
import { DesktopUpdateButton } from "@/components/desktop-update-button";
import { AppUpdateProvider } from "@/components/desktop/app-update-provider";
import settingsStyles from "@/app/(main)/settings/settings.module.css";
import { groups, installUpdateFixture, states, type StateId } from "./fixtures";
import styles from "./states.module.css";

function UpdateStage({ id, choose }: { id: StateId; choose: (_id: StateId) => void }) {
    const [mounted, setMounted] = useState(false);
    const [blocked, setBlocked] = useState(false);
    useEffect(() => {
        if (window.navigatorDesktop) {
            setBlocked(true);
            return;
        }
        const cleanup = installUpdateFixture(id, () => choose("current"));
        setMounted(true);
        return cleanup;
    }, [id, choose]);

    return <main className={`${styles.stage} ${settingsStyles.panel}`} data-category="about">
        {blocked && <p>Open the update workbench in a browser.</p>}
        {mounted && <AppUpdateProvider>
            <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <h1 className={settingsStyles.pageTitle}>About</h1>
                <DesktopUpdateButton />
            </header>
            <AppUpdates />
        </AppUpdateProvider>}
    </main>;
}

export function AppUpdateWorkbench() {
    const params = useSearchParams();
    const active = states.find(state => state.id === params.get("__state"))?.id ?? "ready";
    const [hidden, setHidden] = useState(false);
    const nav = useRef<HTMLElement>(null);

    const choose = useCallback((id: StateId) => {
        const next = new URL(location.href);
        next.searchParams.set("__state", id);
        history.pushState(null, "", next);
    }, []);

    useEffect(() => {
        nav.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
    }, [active, hidden]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing
                || (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=switch]"))) return;
            if (event.key.toLowerCase() === "h") {
                event.preventDefault();
                setHidden(value => !value);
                return;
            }
            const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1
                : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            const index = states.findIndex(state => state.id === active);
            const next = states[(index + step + states.length) % states.length];
            event.preventDefault();
            choose(next.id);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [active, choose]);

    return <div className={styles.page}>
        <div className={styles.layout} data-switcher-hidden={hidden ? "" : undefined}>
            {!hidden && <>
                <nav ref={nav} className={styles.switcher} aria-label="States">
                    {groups.map((group, index) => <div key={group.label} className={styles.group} role="group"
                        aria-labelledby={`update-states-${index}`}>
                        <span id={`update-states-${index}`} className={styles.heading}>
                            <CornerDownRight size={12} aria-hidden="true" />{group.label}
                        </span>
                        {group.items.map(item => <button key={item.id} type="button" aria-pressed={item.id === active}
                            onClick={() => choose(item.id)}>{item.label}</button>)}
                    </div>)}
                </nav>
                <div className={styles.select}>
                    <select aria-label="State" value={active} onChange={event => choose(event.target.value as StateId)}>
                        {groups.map(group => <optgroup key={group.label} label={group.label}>
                            {group.items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </optgroup>)}
                    </select>
                    <ChevronDown size={12} aria-hidden="true" />
                </div>
            </>}
            <UpdateStage key={active} id={active} choose={choose} />
        </div>
    </div>;
}
