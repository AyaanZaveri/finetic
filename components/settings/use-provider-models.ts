"use client";

import { enrichProviderModels, isTextModel, OPENAI_DEFAULT_BASE_URL } from "@/lib/models-dev";
import { useCatalogModels } from "./use-catalog-models";
import { useProviderModelList, type LiveModelProvider } from "./use-openai-models";

const catalogs: Record<LiveModelProvider, string> = {
    openai: "openai", anthropic: "anthropic", gemini: "google", groq: "groq",
    openrouter: "openrouter", cerebras: "cerebras", opencode: "opencode-go",
};

export function useProviderModels({ provider, apiKey, baseUrl }: {
    provider: LiveModelProvider | null;
    apiKey: string;
    baseUrl: string;
}) {
    const customOpenAI = provider === "openai" && baseUrl.trim().replace(/\/+$/, "") !== OPENAI_DEFAULT_BASE_URL;
    const catalog = useCatalogModels(provider && !customOpenAI ? catalogs[provider] : null);
    const liveEnabled = !!provider && (provider !== "openai" || !!baseUrl.trim()) && (!!apiKey.trim() || customOpenAI);
    // Public discovery starts immediately. Key discovery runs independently after
    // a short debounce, so a slow public catalog never blocks the provider.
    const live = useProviderModelList({ provider: provider ?? "openai", enabled: liveEnabled,
        apiKey: apiKey.trim(), baseUrl: provider === "openai" ? baseUrl.trim() : "" });

    if (!provider) return { models: [], loading: false, error: null, description: undefined, live: false };
    if (liveEnabled && !live.loading && !live.error) {
        const models = enrichProviderModels(customOpenAI ? live.models : live.models.filter(model => isTextModel(model.id)), catalog.models);
        return { models, loading: false, error: null, description: models.length ? undefined : "No models returned by the provider. Enter a model ID manually.", live: true };
    }
    if (catalog.models.length) return {
        models: catalog.models,
        loading: liveEnabled && live.loading,
        error: liveEnabled && live.error ? `${live.error} Showing public models.` : null,
        description: liveEnabled && live.loading ? "Checking model access…" : undefined,
        live: false,
    };
    return { models: [], loading: catalog.loading || (liveEnabled && live.loading),
        error: liveEnabled ? live.error : catalog.error, description: undefined, live: false };
}
