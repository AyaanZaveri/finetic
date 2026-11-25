import { MODELS_DEV_API_URL, type ModelsDevApiResponse } from "@/lib/models-dev";

const CATALOG_TTL = 60 * 60 * 1000;
let cached: { payload: ModelsDevApiResponse; expires: number } | undefined;
let pending: Promise<ModelsDevApiResponse> | undefined;

export function loadModelsDevCatalog() {
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.payload);
    if (pending) return pending;
    // Share the full public catalog in memory across discovery and chat.
    // It exceeds the Next.js Data Cache item-size limit.
    pending = (async () => {
        const upstream = await fetch(MODELS_DEV_API_URL, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
        if (!upstream.ok) throw new Error("Failed to fetch provider data from models.dev.");
        const payload = await upstream.json() as ModelsDevApiResponse;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid public catalog.");
        cached = { payload, expires: Date.now() + CATALOG_TTL };
        return payload;
    })().finally(() => { pending = undefined; });
    return pending;
}
