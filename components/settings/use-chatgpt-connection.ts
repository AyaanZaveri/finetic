"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelsDevModel } from "@/lib/models-dev";

const endpoint = "/api/openai/chatgpt";
type Status = {
    available: boolean;
    connection?: { email?: string; signedIn: boolean; planEnabled: boolean } | null;
    attempt?: { status: "pending" | "complete" | "failed"; error?: string };
};

async function read<T>(url: string, options?: Parameters<typeof fetch>[1]): Promise<T> {
    const response = await fetch(url, { cache: "no-store", ...options });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error || "Couldn’t reach ChatGPT. Try again.");
    return data;
}

function action<T>(body: Record<string, unknown>, signal?: AbortSignal) {
    return read<T>(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal,
    });
}

function message(error: unknown) {
    return error instanceof Error ? error.message : "Couldn’t reach ChatGPT. Try again.";
}

export function useChatGPTConnection(enabled: boolean, selected: boolean) {
    const [status, setStatus] = useState<Status | null>(null);
    const [attemptId, setAttemptId] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const [warning, setWarning] = useState<string>();
    const [welcomed, setWelcomed] = useState(false);
    const [revision, setRevision] = useState(0);
    const [catalog, setCatalog] = useState<{ revision: number; models: ModelsDevModel[]; error?: string }>();

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        let failures = 0;
        async function refresh() {
            try {
                const next = await read<Status>(attemptId ? `${endpoint}?attempt=${encodeURIComponent(attemptId)}` : endpoint,
                    { signal: controller.signal });
                if (controller.signal.aborted) return;
                failures = 0;
                setStatus(next);
                if (next.attempt?.status === "pending") {
                    timer = setTimeout(refresh, 1000);
                } else if (attemptId) {
                    setAttemptId(undefined);
                    setError(next.attempt?.error);
                    if (next.attempt?.status === "complete" && next.connection?.planEnabled) {
                        try {
                            const key = "navigator-chatgpt-plan-welcome";
                            if (!localStorage.getItem(key)) {
                                localStorage.setItem(key, "1");
                                setWelcomed(true);
                            }
                        } catch { setWelcomed(true); }
                    }
                }
            } catch (failure) {
                if (controller.signal.aborted) return;
                if (attemptId && ++failures < 4) timer = setTimeout(refresh, 1500);
                else {
                    setAttemptId(undefined);
                    setError(message(failure));
                }
            }
        }
        void refresh();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [enabled, attemptId, revision]);

    const planEnabled = !!status?.connection?.planEnabled;
    useEffect(() => {
        if (!enabled || !selected || !planEnabled || attemptId) return;
        const controller = new AbortController();
        void action<{ models: ModelsDevModel[] }>({ action: "models" }, controller.signal).then(
            ({ models }) => {
                if (!controller.signal.aborted) setCatalog({ revision, models,
                    error: models.length ? undefined : "No models available for this ChatGPT account" });
            },
            failure => {
                if (!controller.signal.aborted) setCatalog({ revision, models: [], error: message(failure) });
            },
        );
        return () => controller.abort();
    }, [enabled, selected, planEnabled, revision, attemptId]);

    const run = useCallback(async (work: () => Promise<void>) => {
        setBusy(true);
        setError(undefined);
        setWarning(undefined);
        try { await work(); }
        catch (failure) { setError(message(failure)); }
        finally { setBusy(false); }
    }, []);

    const start = () => run(async () => {
        const result = await action<{ attemptId: string; url: string }>({ action: "start" });
        setCatalog(undefined);
        setAttemptId(result.attemptId);
        // The desktop shells open off-origin navigation in the system browser.
        window.location.assign(result.url);
    });
    const cancel = () => run(async () => {
        await action({ action: "cancel", attemptId });
        setAttemptId(undefined);
    });
    const signOut = (forget: boolean) => run(async () => {
        const result = await action<{ revoked: boolean }>({ action: "sign-out", forget });
        setStatus(forget ? { available: true } : current => current && {
            ...current, connection: { email: current.connection?.email, signedIn: false, planEnabled: false },
        });
        setCatalog(undefined);
        setRevision(value => value + 1);
        if (!result.revoked) setWarning("Signed out on this device. Open ChatGPT settings to disconnect Navigator there.");
    });

    return {
        available: status?.available === true,
        connection: status?.connection, pending: Boolean(attemptId), busy, error, warning, start, cancel, signOut,
        models: planEnabled && catalog?.revision === revision ? catalog.models : [],
        modelError: catalog?.revision === revision ? catalog.error : undefined,
        modelsLoading: planEnabled && !attemptId && catalog?.revision !== revision,
        reloadModels: () => setRevision(value => value + 1),
        welcomed, dismissWelcome: () => setWelcomed(false),
    };
}
