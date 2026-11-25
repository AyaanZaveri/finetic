"use client";

import { useEffect, useState } from "react";
import type { ModelsDevModel } from "@/lib/models-dev";

type ModelState = { models: ModelsDevModel[]; loading: boolean; error: string | null };
const EMPTY_STATE: ModelState = { models: [], loading: false, error: null };
const LOADING_STATE: ModelState = { models: [], loading: true, error: null };

export type LiveModelProvider = "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "cerebras" | "opencode";

export function useProviderModelList({ enabled, provider, baseUrl, apiKey }: { enabled: boolean; provider: LiveModelProvider; baseUrl: string; apiKey: string }) {
    const [result, setResult] = useState<{ provider: LiveModelProvider; baseUrl: string; apiKey: string; state: ModelState } | null>(null);

    useEffect(() => {
        if (!enabled || (provider === "openai" && !baseUrl.trim())) return;

        let active = true;
        const controller = new AbortController();
        const setState = (state: ModelState) => setResult({ provider, baseUrl, apiKey, state });
        setState(LOADING_STATE);
        const deadline = window.setTimeout(() => {
            controller.abort();
            if (active) setState({ models: [], loading: false, error: "Loading models timed out. You can still enter a model ID manually." });
        }, 15_000);
        const debounce = window.setTimeout(async () => {
            setState(LOADING_STATE);
            try {
                const response = await fetch(provider === "openai" ? "/api/openai/models" : `/api/provider-models?provider=${provider}`, {
                    method: "POST",
                    headers: provider === "openai" ? { "Content-Type": "application/json", "x-openai-api-key": apiKey.trim() } : { "x-provider-api-key": apiKey.trim() },
                    body: provider === "openai" ? JSON.stringify({ baseUrl: baseUrl.trim() }) : undefined,
                    cache: "no-store",
                    signal: controller.signal,
                });
                const data = await response.json() as { models?: ModelsDevModel[]; error?: string };
                if (!response.ok) throw new Error(data.error || "Failed to load available models.");
                if (!Array.isArray(data.models)) throw new Error("The provider returned an invalid model list.");
                if (active && !controller.signal.aborted) setState({
                    models: data.models,
                    loading: false,
                    error: null,
                });
            } catch (error) {
                if (active && !controller.signal.aborted) setState({
                    models: [], loading: false,
                    error: error instanceof Error ? error.message : "Failed to load available models.",
                });
            } finally {
                window.clearTimeout(deadline);
            }
        }, 300);

        return () => {
            active = false;
            window.clearTimeout(debounce);
            window.clearTimeout(deadline);
            controller.abort();
        };
    }, [enabled, provider, baseUrl, apiKey]);

    if (!enabled || (provider === "openai" && !baseUrl.trim())) return EMPTY_STATE;
    return result?.provider === provider && result.baseUrl === baseUrl && result.apiKey === apiKey ? result.state : LOADING_STATE;
}

export function useOpenAIModels(props: { enabled: boolean; baseUrl: string; apiKey: string }) {
    return useProviderModelList({ ...props, provider: "openai" });
}
