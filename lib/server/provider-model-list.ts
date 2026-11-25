import { outboundFetch } from "@/lib/server/outbound-fetch";
import { isTextModel, type ModelsDevModel } from "@/lib/models-dev";

const providers = {
    anthropic: "https://api.anthropic.com/v1/models",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models",
    groq: "https://api.groq.com/openai/v1/models",
    openrouter: "https://openrouter.ai/api/v1/models/user",
    cerebras: "https://api.cerebras.ai/v1/models",
    opencode: "https://opencode.ai/inference/go/v1/models",
} as const;

export type ModelListProvider = keyof typeof providers;
type ProviderModel = {
    id?: string;
    name?: string;
    display_name?: string;
    displayName?: string;
    family?: string;
    supportedGenerationMethods?: string[];
    modalities?: { input?: string[]; output?: string[] };
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
    active?: boolean;
};

export function isModelListProvider(value: string): value is ModelListProvider {
    return Object.hasOwn(providers, value);
}

type ModelListResult = { models: ModelsDevModel[] } | { error: string; status: number };

export async function listProviderModels(provider: ModelListProvider, apiKey: string, requestSignal: AbortSignal): Promise<ModelListResult> {
    const endpoint = new URL(providers[provider]);
    const headers: Record<string, string> = provider === "anthropic"
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : provider === "gemini" ? { "x-goog-api-key": apiKey }
            : { Authorization: `Bearer ${apiKey}` };
    if (provider === "anthropic") endpoint.searchParams.set("limit", "100");
    if (provider === "gemini") endpoint.searchParams.set("pageSize", "100");
    const timeout = AbortSignal.timeout(10_000);
    const signal = AbortSignal.any([requestSignal, timeout]);
    const models = new Map<string, ModelsDevModel>();
    const cursors = new Set<string>();
    try {
        for (let page = 0; page < 20; page++) {
            const upstream = await outboundFetch(endpoint, { headers, signal, cache: "no-store", redirect: "error" }, { provider: true, maxBytes: 8 * 1024 * 1024, timeoutMs: 10_000 });
            if (!upstream.ok) {
                await upstream.body?.cancel();
                return { error: upstream.status === 401 || upstream.status === 403
                    ? "Check your API key and model permissions."
                    : "Could not check model access. Try again.", status: upstream.status };
            }
            const payload = await upstream.json() as { data?: ProviderModel[]; models?: ProviderModel[]; has_more?: boolean; last_id?: string; nextPageToken?: string };
            const entries = provider === "gemini" ? payload.models : payload.data;
            if (!Array.isArray(entries)) return { error: "The provider returned an invalid model list.", status: 502 };
            for (const entry of entries) {
                if (!entry || entry.active === false) continue;
                if (provider === "gemini" && !entry.supportedGenerationMethods?.includes("generateContent")) continue;
                const rawId = provider === "gemini" ? entry.name : entry.id;
                if (typeof rawId !== "string" || !rawId.trim()) continue;
                const id = provider === "gemini" ? rawId.replace(/^models\//, "").trim() : rawId.trim();
                if (!id || !isTextModel(id, entry.modalities ?? { input: entry.architecture?.input_modalities, output: entry.architecture?.output_modalities })) continue;
                const name = provider === "gemini" ? entry.displayName : entry.display_name ?? entry.name;
                models.set(id, { id, name: typeof name === "string" && name.trim() ? name.trim() : id, ...(typeof entry.family === "string" && { family: entry.family }) });
            }
            const cursor = provider === "anthropic" && payload.has_more ? payload.last_id
                : provider === "gemini" ? payload.nextPageToken : undefined;
            if (!cursor) {
                if (provider === "anthropic" && payload.has_more) return { error: "The provider returned an incomplete model list.", status: 502 };
                return { models: [...models.values()].sort((a, b) => a.name.localeCompare(b.name)) };
            }
            if (cursors.has(cursor)) break;
            cursors.add(cursor);
            endpoint.searchParams.set(provider === "anthropic" ? "after_id" : "pageToken", cursor);
        }
        return { error: "The provider returned an incomplete model list.", status: 502 };
    } catch {
        return { error: timeout.aborted ? "Checking model access timed out." : "Could not check model access. Try again.", status: timeout.aborted ? 504 : 502 };
    }
}
