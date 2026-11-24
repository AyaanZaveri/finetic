"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { desktopBridge, type UpdateStatus } from "@/lib/desktop/bridge";
import { AppUpdateDialog } from "./app-update-dialog";

type UpdateView = "update" | "installed";
type UpdateIntent = "prepare" | "install";
type AppUpdateContext = {
    status: UpdateStatus | null;
    openUpdate: (_trigger: HTMLElement, _view?: UpdateView) => void;
    requestUpdate: (_intent: UpdateIntent) => void;
};

const UpdatesContext = createContext<AppUpdateContext>({
    status: null,
    openUpdate() {},
    requestUpdate() {},
});

export function useAppUpdate() {
    return useContext(UpdatesContext);
}

export function AppUpdateProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    const [view, setView] = useState<UpdateView | null>(null);
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const bridge = desktopBridge();
        if (!bridge?.capabilities?.updates) return;
        const unsubscribe = bridge.subscribe(message => { if (message.type === "update-status") setStatus(message); });
        bridge.send({ type: "update-status" });
        return unsubscribe;
    }, []);

    const openUpdate = useCallback((trigger: HTMLElement, nextView: UpdateView = "update") => {
        triggerRef.current = trigger;
        setView(nextView);
        setOpen(true);
    }, []);

    const requestUpdate = useCallback((intent: UpdateIntent) => {
        const bridge = desktopBridge();
        if (!bridge?.capabilities?.updates) return;
        bridge.send(bridge.capabilities.updateReview ? { type: "update-check", intent } : { type: "update-check" });
    }, []);

    return <UpdatesContext.Provider value={{ status, openUpdate, requestUpdate }}>
        {children}
        {status && view && <AppUpdateDialog status={status} view={view} open={open} triggerRef={triggerRef}
            onClose={() => setOpen(false)} requestUpdate={requestUpdate} />}
    </UpdatesContext.Provider>;
}
