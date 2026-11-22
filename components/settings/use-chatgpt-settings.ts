"use client";

import { useEffect, useState } from "react";
import type { ModelsDevModel } from "@/lib/models-dev";

type Status = {
    available: boolean; enabled?: boolean; active?: string; pending?: boolean; model?: string; error?: string;
    accounts?: { clientId: string; label: string; connected: boolean }[];
    revocationConfirmed?: boolean;
};
type Update = { action: "signIn"; clientId?: string } |
    { action: "update"; enabled?: boolean; active?: string; model?: string; modelAccount?: string; signOut?: boolean };

const endpoint = "/api/openai/chatgpt";

async function request<T>(signal?: AbortSignal, action?: Update | { action: "models"; clientId: string }) {
    const response = await fetch(endpoint, {
        cache: "no-store", signal,
        ...(action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Couldn’t load ChatGPT settings.");
    return result as T;
}

export function useChatGPTSettings(enabled: boolean) {
    const [status, setStatus] = useState<Status>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const [catalog, setCatalog] = useState<{ clientId: string; revision: number; models: ModelsDevModel[]; error?: string }>();
    const [reload, setReload] = useState(0);
    const account = status?.accounts?.find(account => account.clientId === status.active);
    const clientId = enabled && !status?.pending && status?.enabled && account?.connected ? account.clientId : undefined;

    useEffect(() => {
        if (!enabled || busy) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const next = await request<Status>(controller.signal);
                if (controller.signal.aborted) return;
                setStatus(next);
                if (next.pending) timer = setTimeout(poll, 1000);
            } catch (error) {
                if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn’t load ChatGPT settings.");
            }
        };
        void poll();
        return () => { controller.abort(); clearTimeout(timer); };
    }, [enabled, busy, revision]);

    useEffect(() => {
        if (!clientId) return;
        const controller = new AbortController();
        request<{ models: ModelsDevModel[] }>(controller.signal, { action: "models", clientId }).then(({ models }) => {
            if (!controller.signal.aborted) setCatalog({ clientId, revision: reload, models });
        }).catch(error => {
            if (!controller.signal.aborted) {
                setCatalog({ clientId, revision: reload, models: [], error: error.message });
                setRevision(value => value + 1);
            }
        });
        return () => controller.abort();
    }, [clientId, reload]);

    async function update(action: Update) {
        setBusy(true);
        setError("");
        try {
            const next = await request<Status>(undefined, action);
            setStatus(next);
            if (action.action === "signIn" || action.active || action.signOut || action.enabled !== undefined) {
                setCatalog(undefined);
                setReload(value => value + 1);
            }
            if (next.revocationConfirmed === false) setError("Signed out in Navigator. To remove access in ChatGPT, disconnect Navigator in ChatGPT settings.");
        } catch (error) {
            setError(error instanceof Error ? error.message : "Couldn’t update ChatGPT settings.");
        } finally {
            setBusy(false);
            setRevision(value => value + 1);
        }
    }

    const current = catalog?.clientId === clientId && catalog?.revision === reload ? catalog : undefined;
    return {
        status, account, busy, error: error || status?.error, update,
        models: current?.models ?? [], modelError: current?.error,
        loading: !!clientId && !current, refreshModels: () => setReload(value => value + 1),
    };
}
