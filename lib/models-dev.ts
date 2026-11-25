export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_LOGO_BASE_URL = "https://models.dev/logos";

type ModelsDevModelRecord = {
  id?: string;
  name?: string;
  family?: string;
  release_date?: string;
  status?: string;
  tool_call?: boolean;
  experimental?: unknown;
  cost?: { input?: number; output?: number };
  modalities?: {
    input?: string[];
    output?: string[];
  };
};

type ModelsDevProviderRecord = {
  id?: string;
  name?: string;
  api?: string;
  models?: Record<string, ModelsDevModelRecord>;
};

export type ModelsDevApiResponse = Record<string, ModelsDevProviderRecord>;

export type ModelsDevModel = {
  id: string;
  name: string;
  family?: string;
  releaseDate?: string;
  status?: string;
  toolCall?: boolean;
  experimental?: boolean;
  inputCost?: number;
  outputCost?: number;
};

export type MatchedModelsDevProvider = {
  id: string;
  name: string;
  apiBaseUrl: string;
  logoUrl: string;
  models: ModelsDevModel[];
};

export type ModelsDevProviderById = {
  id: string;
  name: string;
  apiBaseUrl: string | null;
  logoUrl: string;
  models: ModelsDevModel[];
};

function normalizeBaseUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
        const normalized = new URL(trimmed);
        const pathname = normalized.pathname.replace(/\/+$/, "");
        return `${normalized.origin}${pathname}`.toLowerCase();
    } catch {
        return trimmed.replace(/\/+$/, "").toLowerCase();
    }
}

function getProviderApiBaseUrl(provider: ModelsDevProviderRecord): string | null {
    if (provider.id === "openai") {
        return OPENAI_DEFAULT_BASE_URL;
    }

    return provider.api ?? null;
}

/** Ask Navigator needs models that accept and produce text. */
export function isTextModel(id: string, modalities?: ModelsDevModelRecord["modalities"]): boolean {
    // Catalog modality labels can describe text embeddings and image prompts
    // as text output even when the model cannot answer a chat request.
    if (/(?:^|[\/\-])(?:embedding|embeddings|whisper|tts|transcribe|transcription|moderation|realtime|dall-e|sora|imagen|veo)(?:[\/\-]|$)/i.test(id)
        || /(?:^|\/)(?:gpt-image-|chatgpt-image-|canopylabs\/orpheus-)/i.test(id)) return false;
    if (modalities?.input?.length && !modalities.input.includes("text")) return false;
    if (modalities?.output?.length) return modalities.output.includes("text");
    return true;
}

function catalogTextModels(provider: ModelsDevProviderRecord): ModelsDevModel[] {
    return Object.entries(provider.models ?? {})
        .filter(([id, model]) => isTextModel(model.id ?? id, model.modalities))
        .map(([modelId, model]) => ({
            id: model.id ?? modelId,
            name: model.name ?? model.id ?? modelId,
            family: model.family,
            releaseDate: model.release_date,
            status: model.status,
            toolCall: model.tool_call,
            // models.dev also uses this object for experimental service modes
            // on stable models; only an explicit boolean marks the model itself.
            experimental: model.experimental === true ? true : undefined,
            inputCost: model.cost?.input,
            outputCost: model.cost?.output,
        }));
}

export const SMALL_MODEL_CATALOGS = { openai: "openai", anthropic: "anthropic", gemini: "google" } as const;
export type SmallModelProvider = keyof typeof SMALL_MODEL_CATALOGS;

export function isSmallModelProvider(provider: string): provider is SmallModelProvider {
    return Object.hasOwn(SMALL_MODEL_CATALOGS, provider);
}

/** The catalog has families, not a standardized model-size tier. Only infer
 * lightweight models from known provider families, with older IDs as fallback. */
export function latestSmallModel(provider: SmallModelProvider, models: ModelsDevModel[]): ModelsDevModel | undefined {
    const smallFamily = {
        openai: /(?:^|[-/])(?:luna|mini|nano)(?:[-/]|$)/i,
        anthropic: /(?:^|[-/])haiku(?:[-/]|$)/i,
        gemini: /(?:^|[-/])flash-lite(?:[-/]|$)/i,
    }[provider];
    const alias = /-(?:\d{4}-\d{2}-\d{2}|latest)$/;
    return models.filter(model =>
        model.toolCall === true && /^\d{4}-\d{2}-\d{2}$/.test(model.releaseDate ?? "")
        && (!model.status || model.status === "stable" || model.status === "latest")
        && !model.experimental
        && !/(?:^|[-/])(?:preview|beta|alpha|experimental)(?:[-/]|$)/i.test(model.id)
        && !/-image(?:-|$)/i.test(model.id)
        && (smallFamily.test(model.family ?? "") || smallFamily.test(model.id))
        && isTextModel(model.id)
    ).sort((a, b) =>
        b.releaseDate!.localeCompare(a.releaseDate!)
        || Number(alias.test(a.id)) - Number(alias.test(b.id))
        || (a.outputCost ?? Infinity) - (b.outputCost ?? Infinity)
        || (a.inputCost ?? Infinity) - (b.inputCost ?? Infinity)
        || a.id.localeCompare(b.id)
    )[0];
}

/** The live list controls membership. The public catalog only supplies metadata. */
export function enrichProviderModels(models: ModelsDevModel[], catalog: ModelsDevModel[]): ModelsDevModel[] {
    const metadata = new Map(catalog.map(model => [model.id, model]));
    return models.map(model => {
        const publicModel = metadata.get(model.id);
        return { ...publicModel, ...model, name: publicModel && publicModel.name !== model.id ? publicModel.name : model.name, family: publicModel?.family ?? model.family };
    }).sort((a, b) => a.name.localeCompare(b.name));
}

function getMatchScore(candidateBaseUrl: string, targetBaseUrl: string): number {
    if (candidateBaseUrl === targetBaseUrl) return 1_000;

    try {
        const candidate = new URL(candidateBaseUrl);
        const target = new URL(targetBaseUrl);

        if (candidate.hostname !== target.hostname) return -1;

        const candidatePath = candidate.pathname.replace(/\/+$/, "");
        const targetPath = target.pathname.replace(/\/+$/, "");

        if (candidatePath === targetPath) return 900;
        if (
            candidatePath &&
      (targetPath.startsWith(candidatePath) || candidatePath.startsWith(targetPath))
        ) {
            return 800 - Math.abs(candidatePath.length - targetPath.length);
        }

        return 500;
    } catch {
        return -1;
    }
}

export function matchModelsDevProvider(
    payload: ModelsDevApiResponse,
    baseUrl: string
): MatchedModelsDevProvider | null {
    const normalizedTarget = normalizeBaseUrl(baseUrl);
    if (!normalizedTarget) return null;

    let bestMatch: {
    provider: ModelsDevProviderRecord;
    normalizedBaseUrl: string;
    score: number;
  } | null = null;

    for (const [providerId, provider] of Object.entries(payload)) {
        const providerBaseUrl = getProviderApiBaseUrl({
            ...provider,
            id: provider.id ?? providerId,
        });
        if (!providerBaseUrl) continue;

        const normalizedProviderBaseUrl = normalizeBaseUrl(providerBaseUrl);
        if (!normalizedProviderBaseUrl) continue;

        const score = getMatchScore(normalizedProviderBaseUrl, normalizedTarget);
        if (score < 0) continue;

        if (!bestMatch || score > bestMatch.score) {
            bestMatch = {
                provider: {
                    ...provider,
                    id: provider.id ?? providerId,
                },
                normalizedBaseUrl: normalizedProviderBaseUrl,
                score,
            };
        }
    }

    if (!bestMatch?.provider.id) return null;

    const models = catalogTextModels(bestMatch.provider)
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
        id: bestMatch.provider.id,
        name: bestMatch.provider.name ?? bestMatch.provider.id,
        apiBaseUrl: bestMatch.normalizedBaseUrl,
        logoUrl: `${MODELS_DEV_LOGO_BASE_URL}/${bestMatch.provider.id}.svg`,
        models,
    };
}

export function getModelsDevProviderById(
    payload: ModelsDevApiResponse,
    providerId: string
): ModelsDevProviderById | null {
    const provider = payload[providerId];
    if (!provider) return null;

    const models = catalogTextModels(provider)
        .sort((a, b) => a.id.localeCompare(b.id));

    return {
        id: provider.id ?? providerId,
        name: provider.name ?? providerId,
        apiBaseUrl: getProviderApiBaseUrl({
            ...provider,
            id: provider.id ?? providerId,
        }),
        logoUrl: `${MODELS_DEV_LOGO_BASE_URL}/${provider.id ?? providerId}.svg`,
        models,
    };
}
