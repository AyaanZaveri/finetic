import { getModelsDevProviderById, latestSmallModel, OPENAI_DEFAULT_BASE_URL, SMALL_MODEL_CATALOGS, type SmallModelProvider } from "@/lib/models-dev";
import { loadModelsDevCatalog } from "@/lib/server/models-dev-catalog";
import { outboundFetch } from "@/lib/server/outbound-fetch";
import { listProviderModels } from "@/lib/server/provider-model-list";

async function availableOpenAIModelIds(apiKey: string, signal: AbortSignal) {
    const response = await outboundFetch(`${OPENAI_DEFAULT_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    }, { provider: true, maxBytes: 1024 * 1024, timeoutMs: 10_000 });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Could not check OpenAI model access.");
    }
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(payload.data)) throw new Error("Invalid OpenAI model list.");
    return new Set(payload.data.flatMap(model => typeof model?.id === "string" ? [model.id] : []));
}

async function availableModelIds(provider: SmallModelProvider, apiKey: string, signal: AbortSignal) {
    if (provider === "openai") return availableOpenAIModelIds(apiKey, signal);
    const result = await listProviderModels(provider, apiKey, signal);
    if ("error" in result) throw new Error(result.error);
    return new Set(result.models.map(model => model.id));
}

export async function resolveLatestSmallModel(provider: SmallModelProvider, apiKey: string, signal: AbortSignal) {
    const [catalog, availableIds] = await Promise.all([
        loadModelsDevCatalog(),
        availableModelIds(provider, apiKey, signal),
    ]);
    const models = getModelsDevProviderById(catalog, SMALL_MODEL_CATALOGS[provider])?.models ?? [];
    return latestSmallModel(provider, models.filter(model => availableIds.has(model.id)))?.id;
}
