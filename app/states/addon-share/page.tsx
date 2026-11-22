"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight, Share2 } from "lucide-react";
import { toast } from "sonner";
import { AddonShareContent } from "@/components/addon-share-content";
import { Dialog, DialogTrigger } from "@/components/arc/dialog/dialog";
import { Button } from "@/components/ui/button";
import { fixture, groups, readState, states, type StateId } from "./fixtures";
import styles from "./states.module.css";

const channel = "navigator-addon-share-workbench";

function keyboardCommand(event: KeyboardEvent) {
    const target = event.target;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
    if (event.key.toLowerCase() === "h") return "hide";
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return "next";
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return "previous";
}

function Stage({ id }: { id: StateId }) {
    const { addon, share } = fixture(id);
    const [open, setOpen] = useState(true);
    useEffect(() => {
        if (id !== "copied") return;
        const notice = toast.success("Addon link copied", { duration: Infinity });
        return () => { toast.dismiss(notice); };
    }, [id]);
    return <div className={styles.stage}>
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="outline" size="sm"><Share2 data-icon="inline-start" aria-hidden="true" />Share</Button></DialogTrigger>
            <AddonShareContent addon={addon} state={share} onCopy={() => {
                if (share.kind === "ready") toast.success("Addon link copied");
            }} />
        </Dialog>
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
            <iframe ref={frame} src="/states/addon-share?__stage=1" className={styles.frame}
                title="Addon share workbench" />
        </div>
    </div>;
}

function Workbench() {
    const params = useSearchParams();
    const active = readState(params.get("__state"));
    return params.get("__stage") === "1" ? <StageFrame initialState={active} /> : <Switcher active={active} />;
}

export default function AddonShareStates() {
    return <Suspense><Workbench /></Suspense>;
}
