"use client";
import { useStreamQueries } from "@/components/stream-query-provider";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Cerebras, Gemini, Groq, Ollama, OpenAI, OpenRouter } from "@lobehub/icons";
import { ArrowUpRight, Eye, EyeOff, KeyRound, Link2, Cpu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { OpenCodeIcon } from "@/components/opencode-icon";
import { useCatalogModels } from "./use-catalog-models";
import { ModelIcon } from "@/components/model-icon";
import { Switch } from "@/components/arc/switch/switch";
import { Select } from "@/components/arc/select/select";
import { ActivityTextShimmer } from "@/components/motion-primitives/activity-text-shimmer";
import { Combobox } from "@/components/arc/combobox/combobox";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from "@/components/ui/input-group";
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldTitle,
} from "@/components/ui/field";
import {
    type AIProvider,
    CerebrasReasoningEffort,
    OpenRouterReasoningEffort,
    useSettings,
} from "@/contexts/settings-context";
import { OPENAI_DEFAULT_BASE_URL, type ModelsDevModel } from "@/lib/models-dev";
import { Button } from "@/components/ui/button";
import { getArtworkSettings, saveArtworkToken, removeArtworkToken, saveMetadataProvider, type ArtworkSettingsState } from "@/app/actions/artwork-settings";
import { continueWatchingKey } from "@/lib/media/continue-watching-query";
import { invalidateSeriesSeasons } from "@/lib/media/series-season";
import { AppUpdates } from "./app-updates";
import { PlaybackSettings } from "@/components/playback-settings";
import { PlaybackLanguageSettings } from "@/components/playback-language-settings";
import { SubtitleSettings } from "@/components/subtitle-settings";
import { TinyFishIcon } from "@/components/icons/tinyfish";
import { getWebSearchSettings, saveWebSearchKey, removeWebSearchKey, setWebSearchEnabled } from "@/app/actions/web-search-settings";
import { useConnectionCredential } from "@/components/settings/use-connection-credential";
import { useChatGPTConnection } from "./use-chatgpt-connection";
import { CHATGPT_USAGE_URL } from "@/lib/chatgpt-provider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOpenAIModels } from "@/components/settings/use-openai-models";
import { CONNECTION_CREDENTIALS_EVENT } from "@/lib/browser-connection-credentials";
import { createOptimisticToggle } from "@/lib/optimistic-toggle";
import type { SettingsCategory } from "@/lib/settings-navigation";
import styles from "@/app/(main)/settings/settings.module.css";
import externalLink from "@/components/external-link-reveal.module.css";

// Configuration fields are not sign-in credentials. Keep browser history and
// password managers out of these controls, including model search inputs.
const SETTINGS_INPUT_ATTRIBUTES = {
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    "data-1p-ignore": true,
    "data-lpignore": "true",
    "data-bwignore": true,
    "data-form-type": "other",
} as const;

type ModelsDevProviderResponse = {
    provider: {
        id: string;
        name: string;
        apiBaseUrl: string;
        logoUrl: string;
        models: ModelsDevModel[];
    } | null;
    error?: string;
};

const PROVIDERS: Array<{ value: AIProvider; name: string; icon: ComponentType<{ className?: string }> }> = [
    { value: "openai", name: "OpenAI", icon: OpenAI },
    { value: "gemini", name: "Gemini", icon: Gemini.Color },
    { value: "ollama", name: "Ollama", icon: Ollama },
    { value: "groq", name: "Groq", icon: Groq },
    { value: "openrouter", name: "OpenRouter", icon: OpenRouter },
    { value: "cerebras", name: "Cerebras", icon: Cerebras },
    { value: "opencode", name: "OpenCode Go", icon: OpenCodeIcon },
];

type ModelOption = ModelsDevModel;

type SettingsInputProps = {
    id: string;
    label: string;
    value: string;
    onValueChange: (_value: string) => void;
    placeholder?: string;
    description?: ReactNode;
    type?: "text" | "url";
};

function SettingsInput({ id, label, value, onValueChange, placeholder, description, type = "text" }: SettingsInputProps) {
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <InputGroup className={styles.apiKeyInput}>
                <InputGroupInput
                    {...SETTINGS_INPUT_ATTRIBUTES}
                    id={id}
                    type={type}
                    value={value}
                    onChange={(event) => onValueChange(event.target.value)}
                    placeholder={placeholder}
                    aria-describedby={description ? `${id}-description` : undefined}
                />
                <InputGroupAddon align="inline-start">
                    {type === "url" ? <Link2 aria-hidden="true" /> : <Cpu aria-hidden="true" />}
                </InputGroupAddon>
            </InputGroup>
            {description && <FieldDescription id={`${id}-description`}>{description}</FieldDescription>}
        </Field>
    );
}

function ApiKeyInput({ id, value, onValueChange, keyUrl, label = "API key", description, keyLinkLabel = "Get an API key", error, disabled, icon }: {
    id: string;
    value: string;
    onValueChange: (_value: string) => void;
    keyUrl?: string;
    label?: string;
    description?: string;
    keyLinkLabel?: string;
    error?: string | null;
    disabled?: boolean;
    icon?: ReactNode;
}) {
    const [visible, setVisible] = useState(false);

    return (
        <Field data-invalid={!!error || undefined} data-disabled={disabled || undefined}>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                {keyUrl && (
                    <a draggable={false}
                        href={keyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${styles.keyLink} min-w-0 underline underline-offset-4 hover:text-foreground`}
                    >
                        {keyLinkLabel}
                    </a>
                )}
            </div>
            <InputGroup className={styles.apiKeyInput}>
                <InputGroupInput
                    {...SETTINGS_INPUT_ATTRIBUTES}
                    id={id}
                    type={visible ? "text" : "password"}
                    value={value}
                    onChange={(event) => onValueChange(event.target.value)}
                    aria-describedby={[description && `${id}-description`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
                    aria-invalid={!!error || undefined}
                    disabled={disabled}
                    autoComplete="new-password"
                />
                <InputGroupAddon align="inline-start">
                    {icon || <KeyRound aria-hidden="true" />}
                </InputGroupAddon>
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        size="icon-xs"
                        type="button"
                        disabled={disabled}
                        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
                        aria-controls={id}
                        aria-pressed={visible}
                        onClick={() => setVisible((current) => !current)}
                    >
                        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
            {description && <FieldDescription id={`${id}-description`}>
                {description}
            </FieldDescription>}
            {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
        </Field>
    );
}

function WebSearchSettings({ variant }: { variant: "preference" | "connection" }) {
    const [state, setState] = useState<Awaited<ReturnType<typeof getWebSearchSettings>>>({ configured: false, personal: false, enabled: true });
    const { value: key, setValue: setKey, persist: persistKey } = useConnectionCredential("tinyfish");
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState("");
    const stateRef = useRef(state);
    const toggleQueue = useRef<ReturnType<typeof createOptimisticToggle> | null>(null);
    const loadVersion = useRef(0);
    useEffect(() => {
        const queue = createOptimisticToggle({
            read: () => stateRef.current.enabled,
            update: enabled => {
                stateRef.current = { ...stateRef.current, enabled };
                setState(previous => ({ ...previous, enabled }));
            },
            save: async enabled => {
                const result = await setWebSearchEnabled(enabled);
                if (!result.success) throw new Error(result.error);
                return result.enabled;
            },
            failed: error => setError(error instanceof Error ? error.message : "Couldn’t update web search. Try again."),
        });
        toggleQueue.current = queue;
        return () => { queue.dispose(); toggleQueue.current = null; };
    }, []);
    useEffect(() => {
        let active = true;
        const load = () => {
            const version = ++loadVersion.current;
            const wasPending = toggleQueue.current?.isPending();
            return getWebSearchSettings().then(value => {
                if (active && version === loadVersion.current && !wasPending && !toggleQueue.current?.isPending()) {
                    stateRef.current = value;
                    setState(value);
                }
            })
                .catch(() => { if (active && version === loadVersion.current && !wasPending && !toggleQueue.current?.isPending()) setError("Couldn’t load web search settings."); })
                .finally(() => { if (active) setLoading(false); });
        };
        void load();
        window.addEventListener(CONNECTION_CREDENTIALS_EVENT, load);
        return () => { active = false; window.removeEventListener(CONNECTION_CREDENTIALS_EVENT, load); };
    }, []);
    async function update(operation: "save" | "remove") {
        setPending(true); setError(null); setStatus("");
        try {
            const result = operation === "save" ? await saveWebSearchKey(key) : await removeWebSearchKey();
            if (!result.success) { setError(result.error); return; }
            stateRef.current = { configured: result.configured, personal: result.personal, enabled: result.enabled };
            setState(stateRef.current);
            if (operation === "save") persistKey(key.trim());
            if (operation === "remove") persistKey("");
            setStatus(operation === "save" ? "Key saved." : operation === "remove" ? "Key removed." : "");
        } catch { setError("Couldn’t update web search. Try again."); }
        finally { setPending(false); }
    }
    return <section aria-label={variant === "connection" ? "TinyFish connection" : "Web search"} className={styles.section}>
        <h2>Web search</h2>
        <div className={`flex min-w-0 flex-col ${variant === "preference" ? "gap-2" : "gap-4"}`}>
            {variant === "preference" && <Field orientation="horizontal">
                <FieldContent><FieldLabel htmlFor="tinyfish-web-search"><TinyFishIcon size={16} className="shrink-0" />Use TinyFish web search</FieldLabel></FieldContent>
                <Switch id="tinyfish-web-search" checked={state.enabled && state.configured} disabled={loading || pending || !state.configured}
                    onCheckedChange={enabled => {
                        loadVersion.current++;
                        setError(null);
                        toggleQueue.current?.set(enabled);
                    }} />
            </Field>}
            {variant === "preference" && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {variant === "preference" && !loading && !state.configured && <p className={styles.description}>
                <Link draggable={false} href="/settings/connections" className={styles.keyLink}>Connect TinyFish</Link> to enable web search.
            </p>}
            {variant === "connection" && <form autoComplete="off" data-form-type="other" className="min-w-0" aria-busy={loading || pending} onSubmit={event => { event.preventDefault(); if (!pending && key.trim()) void update("save"); }}>
                <FieldGroup className="gap-4">
                    <ApiKeyInput id="tinyfish-api-key" label="TinyFish API key" value={key} icon={<TinyFishIcon />}
                        onValueChange={value => { setKey(value); setError(null); setStatus(""); }} keyUrl="https://tinyfish.ai" keyLinkLabel="Get a TinyFish key"
                        disabled={loading || pending} error={error} />
                    <div className="flex flex-wrap items-center gap-1">
                        <Button type="submit" variant="outline" size="sm" disabled={loading || pending || !key.trim()}>{pending ? "Updating…" : "Save key"}</Button>
                        {(state.personal || key) && <Button type="button" variant="ghost" size="sm" disabled={loading || pending} onClick={() => void update("remove")}>Remove key</Button>}
                    </div>
                </FieldGroup>
            </form>}
            <p role="status" className={styles.feedback}>{status}</p>
        </div>
    </section>;
}

function ArtworkSettings() {
    const queries = useStreamQueries();
    const [state, setState] = useState<ArtworkSettingsState>({ configured: false, personal: false, provider: "auto" });
    const { value: token, setValue: setToken, persist: persistToken } = useConnectionCredential("tmdb");
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState<"save" | "remove" | "provider" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [providerError, setProviderError] = useState<string | null>(null);
    const [status, setStatus] = useState("");
    useEffect(() => {
        let active = true;
        const load = () => getArtworkSettings().then((value) => {
            if (active) setState(value);
        }).catch(() => {
            if (active) setError("Couldn’t load artwork settings. Reload the page to try again.");
        }).finally(() => { if (active) setLoading(false); });
        void load();
        window.addEventListener(CONNECTION_CREDENTIALS_EVENT, load);
        return () => { active = false; window.removeEventListener(CONNECTION_CREDENTIALS_EVENT, load); };
    }, []);

    async function update(operation: "save" | "remove" | ArtworkSettingsState["provider"]) {
        const changingProvider = operation !== "save" && operation !== "remove";
        const showError = changingProvider ? setProviderError : setError;
        setPending(changingProvider ? "provider" : operation);
        setError(null);
        setProviderError(null);
        setStatus("");
        try {
            const result = operation === "save" ? await saveArtworkToken(token)
                : operation === "remove" ? await removeArtworkToken() : await saveMetadataProvider(operation);
            if (!result.success) { showError(result.error); return; }
            queries?.metadata.invalidate();
            invalidateSeriesSeasons();
            if (queries) {
                void queries.client.invalidateQueries({ queryKey: continueWatchingKey(queries.scope) });
                void queries.client.invalidateQueries({ queryKey: ["player-drawer"] });
            }
            setState(result);
            if (operation === "save" || operation === "remove") persistToken(operation === "save" ? token.trim() : "");
            setStatus(operation === "save" ? "Token saved." : operation === "remove" ? "Token removed." : "Metadata provider saved.");
        } catch {
            showError("Couldn’t save the setting. Check your connection and try again.");
        } finally { setPending(null); }
    }

    return (
        <section id="tmdb" aria-labelledby="artwork-settings-title" className={styles.section}>
            <h2 id="artwork-settings-title">Metadata and artwork</h2>
            <Select id="metadata-provider" label="Metadata provider" value={state.provider}
                disabled={loading || !!pending}
                aria-describedby={providerError ? "metadata-provider-error" : undefined}
                description={state.configured ? "Choose the source for browsing, search, and title details."
                    : "Connect a TMDB token to use TMDB. Cinemeta works without a token."}
                options={[
                    { value: "auto", label: "Automatic" },
                    { value: "tmdb", label: "TMDB", disabled: !state.configured },
                    { value: "cinemeta", label: "Cinemeta" },
                ]}
                onValueChange={value => {
                    if (value === "auto" || value === "tmdb" || value === "cinemeta") void update(value);
                }} />
            {providerError && <p id="metadata-provider-error" role="alert" className="text-sm text-destructive">{providerError}</p>}
            <form autoComplete="off" data-form-type="other" className="min-w-0" aria-busy={loading || !!pending} onSubmit={(event) => { event.preventDefault(); if (!pending && token.trim()) void update("save"); }}>
                <FieldGroup className="gap-4">
                    <ApiKeyInput
                        id="tmdb-read-access-token"
                        label="TMDB read access token"
                        value={token}
                        onValueChange={(value) => { setToken(value); setError(null); setStatus(""); }}
                        keyUrl="https://www.themoviedb.org/settings/api"
                        keyLinkLabel="Get a TMDB token"
                        disabled={loading || !!pending}
                        error={error}
                    />
                    <div className="flex flex-wrap items-center gap-1">
                        <Button type="submit" variant="outline" size="sm" disabled={loading || !!pending || !token.trim()}>{pending === "save" ? "Checking token…" : "Save token"}</Button>
                        {(state.personal || token) && <Button type="button" variant="ghost" size="sm" disabled={loading || !!pending} onClick={() => void update("remove")}>{pending === "remove" ? "Removing…" : "Remove token"}</Button>}
                    </div>
                    <p role="status" className={styles.feedback}>{status}</p>
                </FieldGroup>
            </form>
        </section>
    );
}

type SettingsSelectProps = {
    id: string;
    label: string;
    value: string;
    onValueChange: (_value: string) => void;
    options: ModelOption[];
    description?: ReactNode;
    loading?: boolean;
    error?: string | null;
    disabled?: boolean;
};

function SettingsSelect({ id, label, value, onValueChange, options, description, loading, error, disabled }: SettingsSelectProps) {
    const unavailable = disabled || (loading && options.length === 0);
    const describedBy = [
        (loading || description) && `${id}-description`,
        error && `${id}-error`,
    ].filter(Boolean).join(" ") || undefined;

    return (
        <Field data-disabled={unavailable || undefined}>
            <Select
                id={id}
                label={label}
                value={value}
                onValueChange={onValueChange}
                disabled={unavailable}
                aria-describedby={describedBy}
                aria-busy={loading || undefined}
                placeholder={loading ? "Loading models…" : `Select ${label.toLowerCase()}`}
                options={options.length ? options.map((option) => ({ value: option.id, label: option.name })) : [{ value: "__no_options__", label: "No options available", disabled: true }]}
            />
            {(loading || description) && (
                <FieldDescription id={`${id}-description`} role="status">
                    {loading ? "Loading available models…" : description}
                </FieldDescription>
            )}
            {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
        </Field>
    );
}

function ModelCombobox({ id, value, onValueChange, options, description, loading, error, disabled, providerIcon }: Omit<SettingsSelectProps, "label"> & { providerIcon: ComponentType<{ className?: string }> }) {
    const catalogModel = options.find(option => option.id === value);
    const catalogName = catalogModel?.name !== value ? catalogModel?.name : undefined;
    const cacheKey = `navigator-${id}-display-name`;
    const [cached, setCached] = useState<{ id: string; name: string } | null | undefined>(undefined);

    useLayoutEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
            setCached(typeof saved?.id === "string" && typeof saved?.name === "string" && saved.name
                ? { id: saved.id, name: saved.name } : null);
        } catch {
            setCached(null);
        }
    }, [cacheKey]);

    useEffect(() => {
        if (!catalogName) return;
        const selection = { id: value, name: catalogName };
        setCached(selection);
        try { localStorage.setItem(cacheKey, JSON.stringify(selection)); } catch { /* Storage can be unavailable. */ }
    }, [cacheKey, catalogName, value]);

    const savedName = cached?.id === value ? cached.name : undefined;
    const waitingForName = !!value && !catalogModel && !savedName && !disabled && (cached === undefined || loading);
    const selected = value && !waitingForName
        ? { ...catalogModel, id: value, name: catalogName ?? savedName ?? value }
        : null;
    const unavailable = disabled || waitingForName;

    if (waitingForName) {
        return <Field aria-busy="true">
            <FieldLabel>Model</FieldLabel>
            <ActivityTextShimmer role="status">Loading model…</ActivityTextShimmer>
        </Field>;
    }

    const describedBy = [
        (loading || description) && `${id}-description`,
        error && `${id}-error`,
    ].filter(Boolean).join(" ") || undefined;

    return (
        <Field data-disabled={unavailable || undefined}>
            <Combobox
                {...SETTINGS_INPUT_ATTRIBUTES}
                className={styles.providerInput}
                id={id}
                label="Model"
                value={value}
                onValueChange={onValueChange}
                options={(selected && !catalogModel ? [selected, ...options] : options).map((model) => ({
                    value: model.id,
                    label: model.id === selected?.id ? selected.name : model.name,
                    keywords: [model.id],
                    icon: <ModelIcon model={model} fallbackIcon={providerIcon} />,
                }))}
                placeholder={loading ? "Loading models…" : "Search models…"}
                emptyMessage={loading ? "Loading models…" : "No models found."}
                aria-describedby={describedBy}
                aria-busy={loading || undefined}
                disabled={unavailable}
            />
            {(loading || description) && (
                <FieldDescription id={`${id}-description`} role="status">
                    {loading ? "Loading available models…" : description}
                </FieldDescription>
            )}
            {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
        </Field>
    );
}

function NavigatorSettings() {
    const {
        navigatorEnabled,
        setNavigatorEnabled,
        aiProvider,
        setAiProvider,
        openaiBaseUrl,
        setOpenaiBaseUrl,
        openaiAuthMethod,
        setOpenaiAuthMethod,
        chatGPTModel,
        setChatGPTModel,
        openaiModel,
        setOpenaiModel,
        geminiModel,
        setGeminiModel,
        ollamaApiKey,
        setOllamaApiKey,
        ollamaBaseUrl,
        setOllamaBaseUrl,
        ollamaModel,
        setOllamaModel,
        groqModel,
        setGroqModel,
        openrouterModel,
        setOpenrouterModel,
        openrouterReasoningEffort,
        setOpenrouterReasoningEffort,
        cerebrasModel,
        setCerebrasModel,
        cerebrasReasoningEffort,
        setCerebrasReasoningEffort,
        opencodeModel,
        setOpencodeModel,
        openaiApiKey,
        setOpenaiApiKey,
        googleApiKey,
        setGoogleApiKey,
        groqApiKey,
        setGroqApiKey,
        openrouterApiKey,
        setOpenrouterApiKey,
        cerebrasApiKey,
        setCerebrasApiKey,
        opencodeApiKey,
        setOpencodeApiKey,
    } = useSettings();

    const [cerebrasModels, setCerebrasModels] = useState<string[]>([]);
    const [isLoadingCerebrasModels, setIsLoadingCerebrasModels] = useState(false);
    const [cerebrasModelsError, setCerebrasModelsError] = useState<string | null>(
        null
    );
    const usingChatGPT = aiProvider === "openai" && openaiAuthMethod === "chatgpt";
    const chatGPT = useChatGPTConnection(navigatorEnabled && aiProvider === "openai", usingChatGPT);
    const { models: openaiModels, loading: isLoadingOpenAIModels, error: openaiModelsError } = useOpenAIModels({
        enabled: navigatorEnabled && aiProvider === "openai" && !usingChatGPT,
        baseUrl: openaiBaseUrl,
        apiKey: openaiApiKey,
    });
    const [geminiModelsProvider, setGeminiModelsProvider] =
    useState<ModelsDevProviderResponse["provider"]>();
    const [isLoadingGeminiModels, setIsLoadingGeminiModels] = useState(false);
    const [geminiModelsError, setGeminiModelsError] = useState<string | null>(
        null
    );
    const catalog = useCatalogModels(
        aiProvider === "opencode" ? "opencode-go"
            : aiProvider === "groq" || aiProvider === "openrouter" ? aiProvider : null
    );

    const fetchGeminiModels = useCallback(async () => {
        setIsLoadingGeminiModels(true);
        setGeminiModelsError(null);

        try {
            const params = new URLSearchParams({ providerId: "google" });
            const response = await fetch(`/api/models-dev/provider?${params.toString()}`);
            const data = (await response.json()) as ModelsDevProviderResponse;

            if (!response.ok) {
                throw new Error(data.error || "Failed to load Gemini models.");
            }

            setGeminiModelsProvider(data.provider ?? null);
        } catch (error) {
            console.error("Failed to load Gemini models:", error);
            setGeminiModelsProvider(null);
            setGeminiModelsError(
                error instanceof Error ? error.message : "Failed to load Gemini models."
            );
        } finally {
            setIsLoadingGeminiModels(false);
        }
    }, []);

    const fetchCerebrasModels = useCallback(async () => {
        if (!cerebrasApiKey.trim()) {
            setCerebrasModels([]);
            setCerebrasModelsError(null);
            return;
        }

        setIsLoadingCerebrasModels(true);
        setCerebrasModelsError(null);

        try {
            const response = await fetch("/api/cerebras/models", {
                method: "GET",
                headers: {
                    "x-cerebras-api-key": cerebrasApiKey.trim(),
                },
            });

            const data = (await response.json()) as {
                models?: string[];
                error?: string;
            };

            if (!response.ok) {
                throw new Error(data.error || "Failed to fetch Cerebras models.");
            }

            const models = Array.isArray(data.models) ? data.models : [];
            setCerebrasModels(models);
            if (!models.length) setCerebrasModelsError("No models are currently available.");
        } catch (error) {
            console.error("Failed to load Cerebras models:", error);
            setCerebrasModels([]);
            setCerebrasModelsError(
                error instanceof Error
                    ? error.message
                    : "Failed to load Cerebras models."
            );
        } finally {
            setIsLoadingCerebrasModels(false);
        }
    }, [cerebrasApiKey]);

    useEffect(() => {
        if (aiProvider !== "gemini") return;
        const timeout = window.setTimeout(() => void fetchGeminiModels(), 0);
        return () => window.clearTimeout(timeout);
    }, [aiProvider, fetchGeminiModels]);

    useEffect(() => {
        if (aiProvider !== "cerebras") return;
        const timeout = window.setTimeout(() => void fetchCerebrasModels(), 400);
        return () => window.clearTimeout(timeout);
    }, [aiProvider, fetchCerebrasModels]);

    const selectedProvider = PROVIDERS.find((provider) => provider.value === aiProvider)!;
    const apiKeySettings = {
        openai: { value: openaiApiKey, onValueChange: setOpenaiApiKey, keyUrl: openaiBaseUrl.replace(/\/+$/, "") === OPENAI_DEFAULT_BASE_URL ? "https://platform.openai.com/api-keys" : undefined },
        gemini: { value: googleApiKey, onValueChange: setGoogleApiKey, keyUrl: "https://aistudio.google.com/apikey" },
        groq: { value: groqApiKey, onValueChange: setGroqApiKey, keyUrl: "https://console.groq.com/keys" },
        openrouter: { value: openrouterApiKey, onValueChange: setOpenrouterApiKey, keyUrl: "https://openrouter.ai/keys" },
        cerebras: { value: cerebrasApiKey, onValueChange: setCerebrasApiKey, keyUrl: "https://cloud.cerebras.ai" },
        opencode: { value: opencodeApiKey, onValueChange: setOpencodeApiKey, keyUrl: "https://opencode.ai/auth" },
    };
    const modelSettings: Record<AIProvider, Omit<SettingsSelectProps, "id" | "label" | "options"> & { options?: ModelOption[]; placeholder?: string }> = {
        openai: {
            value: openaiModel, onValueChange: setOpenaiModel, options: openaiModels,
            loading: isLoadingOpenAIModels, error: openaiModelsError,
        },
        gemini: {
            value: geminiModel, onValueChange: setGeminiModel, options: geminiModelsProvider?.models ?? [],
            loading: geminiModelsProvider === undefined || isLoadingGeminiModels, error: geminiModelsError,
        },
        ollama: {
            value: ollamaModel, onValueChange: setOllamaModel, placeholder: "phi3",
            description: <a draggable={false} href="https://ollama.com/search?c=tools" target="_blank" rel="noopener noreferrer">Browse Ollama models</a>,
        },
        groq: {
            value: groqModel, onValueChange: setGroqModel, options: catalog.models,
            loading: catalog.loading, error: catalog.error,
        },
        openrouter: {
            value: openrouterModel, onValueChange: setOpenrouterModel, options: catalog.models,
            loading: catalog.loading, error: catalog.error,
        },
        cerebras: {
            value: cerebrasModel, onValueChange: setCerebrasModel,
            options: cerebrasModels.map((id) => ({ id, name: id })),
            loading: isLoadingCerebrasModels || (cerebrasModels.length === 0 && !cerebrasModelsError), error: cerebrasModelsError, disabled: !cerebrasApiKey.trim(),
        },
        opencode: {
            value: opencodeModel, onValueChange: setOpencodeModel, options: catalog.models,
            loading: catalog.loading, error: catalog.error,
        },
    };
    const currentModel = modelSettings[aiProvider];

    return <>
    <Dialog open={chatGPT.welcomed} onOpenChange={open => { if (!open) chatGPT.dismissWelcome(); }}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>You’re using your ChatGPT plan</DialogTitle>
                <DialogDescription>Eligible Ask Navigator requests use your ChatGPT plan. You can review usage and manage limits in ChatGPT settings.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <Button asChild variant="outline"><a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer">Manage usage</a></Button>
                <Button type="button" onClick={chatGPT.dismissWelcome}>Got it</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    <section aria-labelledby="settings-assistant-title" className={`${styles.section} ${styles.navigatorSettings}`}>
        <h2 id="settings-assistant-title">Assistant</h2>
        <FieldGroup className={styles.navigatorPreferences}>
            <Field orientation="horizontal">
                <FieldContent>
                    <FieldLabel htmlFor="navigator-enabled">Use Ask Navigator</FieldLabel>
                </FieldContent>
                <Switch
                    id="navigator-enabled"
                    checked={navigatorEnabled}
                    onCheckedChange={setNavigatorEnabled}
                />
            </Field>
        </FieldGroup>
        {navigatorEnabled && (
            <FieldGroup className={styles.navigatorFields} aria-label="AI configuration">
                <Field>
                    <Select
                        id="ai-provider"
                        label="AI provider"
                        value={aiProvider}
                        onValueChange={(value) => setAiProvider(value as AIProvider)}
                        options={PROVIDERS.map((provider) => {
                            const Icon = provider.icon;
                            return { value: provider.value, label: provider.name, icon: <Icon /> };
                        })}
                    />
                </Field>

                {aiProvider === "openai" && (chatGPT.available || usingChatGPT) && (
                    <SettingsSelect id="openai-auth-method" label="Connection" value={openaiAuthMethod}
                        disabled={chatGPT.pending || chatGPT.busy}
                        onValueChange={value => setOpenaiAuthMethod(value === "chatgpt" ? "chatgpt" : "api-key")}
                        options={[
                            { id: "api-key", name: "API key" },
                            { id: "chatgpt", name: "Sign in with ChatGPT" },
                        ]}
                    />
                )}

                {usingChatGPT && (
                    <Field>
                        <FieldLabel>ChatGPT account</FieldLabel>
                        <FieldDescription role="status">
                            {chatGPT.pending ? "Finish signing in in your browser." :
                                chatGPT.connection?.signedIn ? <>
                                    {chatGPT.connection.email || "Signed in to ChatGPT"}.{" "}
                                    {chatGPT.connection.planEnabled ? "Using ChatGPT plan." : "ChatGPT plan usage needs permission."}
                                </> : chatGPT.connection?.email ? `Signed out of ${chatGPT.connection.email}.` :
                                    "Use your ChatGPT plan for eligible Ask Navigator requests."}
                        </FieldDescription>
                        {chatGPT.error && <FieldError role="alert">{chatGPT.error}</FieldError>}
                        {chatGPT.warning && <FieldDescription role="status">{chatGPT.warning}{" "}
                            <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer">Open ChatGPT settings</a>
                        </FieldDescription>}
                        <div className="flex flex-wrap items-center gap-2">
                            {chatGPT.pending ?
                                <Button type="button" variant="outline" size="sm" disabled={chatGPT.busy} onClick={chatGPT.cancel}>Cancel sign-in</Button>
                                : <>
                                    <Button type="button" size="sm" className="bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200" disabled={!chatGPT.available || chatGPT.busy} onClick={chatGPT.start}>
                                        <OpenAI aria-hidden="true" /> Continue with ChatGPT
                                    </Button>
                                    {chatGPT.connection?.signedIn ?
                                        <Button type="button" variant="outline" size="sm" disabled={chatGPT.busy} onClick={() => void chatGPT.signOut(false)}>Sign out</Button>
                                        : chatGPT.connection &&
                                            <Button type="button" variant="ghost" size="sm" disabled={chatGPT.busy} onClick={() => {
                                                setChatGPTModel("");
                                                void chatGPT.signOut(true);
                                            }}>Forget account</Button>}
                                    {chatGPT.connection?.planEnabled && <Button asChild variant="link" size="sm">
                                        <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer">Manage usage</a>
                                    </Button>}
                                </>}
                        </div>
                    </Field>
                )}

                {aiProvider === "openai" && !usingChatGPT && (
                    <SettingsInput
                        id="openai-base-url"
                        label="Base URL"
                        type="url"
                        value={openaiBaseUrl}
                        onValueChange={setOpenaiBaseUrl}
                        placeholder={OPENAI_DEFAULT_BASE_URL}
                    />
                )}

                {aiProvider === "ollama" ? (
                    <>
                        <SettingsInput
                            id="ollama-base-url"
                            label="Base URL"
                            type="url"
                            value={ollamaBaseUrl}
                            onValueChange={setOllamaBaseUrl}
                            placeholder="http://localhost:11434"
                        />
                        <ApiKeyInput id="ollama-api-key" label="API key (optional)" description="Required only if your Ollama server uses authentication." value={ollamaApiKey} onValueChange={setOllamaApiKey} />
                    </>
                ) : !usingChatGPT && (
                    <ApiKeyInput key={`${aiProvider}-api-key`} id={`${aiProvider}-api-key`} {...apiKeySettings[aiProvider]} />
                )}

                {usingChatGPT ? chatGPT.connection?.planEnabled && (
                    <>
                        <SettingsSelect id="chatgpt-model" label="Model" options={chatGPT.models}
                            value={chatGPTModel ? (chatGPT.models.some(model => model.id === chatGPTModel) ? chatGPTModel : "") : chatGPT.models[0]?.id ?? ""}
                            onValueChange={setChatGPTModel}
                            loading={chatGPT.modelsLoading}
                            error={chatGPT.modelError}
                            disabled={!chatGPT.models.length || chatGPT.pending || chatGPT.busy} />
                        {chatGPT.modelError && <div>
                            <Button type="button" variant="outline" size="sm" onClick={chatGPT.reloadModels}>Reload models</Button>
                        </div>}
                    </>
                ) : currentModel.options ? (
                    <ModelCombobox key={`${aiProvider}-model`} id={`${aiProvider}-model`} {...currentModel} description={currentModel.disabled ? "Add an API key to load models." : undefined} options={currentModel.options} providerIcon={selectedProvider.icon} />
                ) : (
                    <SettingsInput
                        id={`${aiProvider}-model`}
                        label="Model"
                        value={currentModel.value}
                        onValueChange={currentModel.onValueChange}
                        placeholder={currentModel.placeholder}
                        description={currentModel.description}
                    />
                )}

                {aiProvider === "openrouter" && (
                    <SettingsSelect
                        id="openrouter-reasoning-effort"
                        label="Reasoning effort"
                        value={openrouterReasoningEffort}
                        onValueChange={(value) => setOpenrouterReasoningEffort(value as OpenRouterReasoningEffort)}
                        options={[
                            { id: "default", name: "Model default" },
                            { id: "none", name: "None" },
                            { id: "minimal", name: "Minimal" },
                            { id: "low", name: "Low" },
                            { id: "medium", name: "Medium" },
                            { id: "high", name: "High" },
                            { id: "xhigh", name: "Extra high" },
                        ]}
                    />
                )}

                {aiProvider === "cerebras" && (
                    <SettingsSelect
                        id="cerebras-reasoning-effort"
                        label="Reasoning effort"
                        value={cerebrasReasoningEffort}
                        onValueChange={(value) => setCerebrasReasoningEffort(value as CerebrasReasoningEffort)}
                        options={[
                            { id: "default", name: "Model default" },
                            { id: "low", name: "Low" },
                            { id: "medium", name: "Medium" },
                            { id: "high", name: "High" },
                        ]}
                    />
                )}
            </FieldGroup>
        )}
    </section>
    {navigatorEnabled && <WebSearchSettings variant="preference" />}
    </>;
}

const skipTimingProviders = [
    { name: "TheIntroDB", href: "https://theintrodb.org", logo: "/logo/credits/theintrodb.svg" },
    { name: "IntroDB", href: "https://introdb.app", logo: "/logo/credits/introdb.svg" },
    { name: "SkipDB", href: "https://skipdb.tv/license", logo: "/logo/credits/skipdb.png" },
];

export function SettingsView({ category }: { category: SettingsCategory }) {
    switch (category) {
    case "about":
        return <><AppUpdates />
            <section aria-labelledby="settings-credits" className={styles.section}>
            <h2 id="settings-credits">Credits and licenses</h2>
            <Field aria-labelledby="skip-timing-credits" className="gap-2">
                <FieldTitle id="skip-timing-credits">Skip timings</FieldTitle>
                <div className="flex flex-wrap items-center gap-1">
                    {skipTimingProviders.map(provider => <Button key={provider.name} asChild variant="outline" size="sm">
                            <a draggable={false} className={externalLink.link} href={provider.href} target="_blank" rel="noreferrer">
                                <Image src={provider.logo} width={20} height={20} className="size-5 shrink-0 rounded-sm object-contain" alt="" unoptimized data-icon="inline-start" />
                                <span className="inline-flex items-center">
                                    {provider.name}
                                    <span className={externalLink.arrow} aria-hidden="true">
                                        <ArrowUpRight className="size-4" strokeWidth={2} absoluteStrokeWidth />
                                    </span>
                                </span>
                            </a>
                        </Button>)}
                </div>
            </Field>
            </section>
        </>;
    case "playback":
        return <PlaybackSettings />;
    case "subtitles":
        return <><PlaybackLanguageSettings kind="subtitles" /><SubtitleSettings /></>;
    case "navigator":
        return <NavigatorSettings />;
    case "connections":
        return <><ArtworkSettings /><WebSearchSettings variant="connection" /></>;
    }
}
