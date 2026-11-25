import * as artwork from "@/app/actions/artwork-settings";
import * as webSearch from "@/app/actions/web-search-settings";
import type { DesktopBridge, NativeMessage, UpdateStatus } from "@/lib/desktop/bridge";
import { KEYBOARD_SEEK_SECONDS, PLAYBACK_PREFERENCES_KEY, type PlaybackPreferences } from "@/lib/media/playback-preferences";
import type { ModelsDevModel } from "@/lib/models-dev";
import { installedVersion, releaseVersion } from "../app-updates/fixtures";
import { isReleaseNotesState, type StateId } from "./states";

const artworkToken = "fixture-tmdb-read-access-token";
const webSearchKey = "fixture-tinyfish-api-key";

const playback: Partial<Record<StateId, Partial<PlaybackPreferences>>> = {
    "playback-custom": { keyboardSeekBackwardSeconds: 5, keyboardSeekForwardSeconds: 15 },
    "playback-minimum": {
        keyboardSeekBackwardSeconds: KEYBOARD_SEEK_SECONDS.min,
        keyboardSeekForwardSeconds: KEYBOARD_SEEK_SECONDS.min,
    },
    "playback-maximum": {
        keyboardSeekBackwardSeconds: KEYBOARD_SEEK_SECONDS.max,
        keyboardSeekForwardSeconds: KEYBOARD_SEEK_SECONDS.max,
    },
    "playback-webgpu-off": { webGpuPlayback: false },
    "playback-webgpu-decoding": { nativeWebGpuDecoding: true },
    "playback-web-hdr": { hdrOutput: true, hdrPeakNits: 1200 },
    "playback-native-custom": { nativeHdrPeakNits: 1600 },
    "subtitles-enabled": { subtitlesEnabledByDefault: true },
    "subtitles-forced": { subtitlesEnabledByDefault: true, subtitleMode: "forced", subtitleLanguage: "fr" },
};

const providers: Partial<Record<StateId, string>> = {
    "navigator-gemini": "gemini",
    "navigator-ollama": "ollama",
    "navigator-groq": "groq",
    "navigator-openrouter": "openrouter",
    "navigator-cerebras-no-key": "cerebras",
    "navigator-cerebras": "cerebras",
    "navigator-opencode": "opencode",
    "navigator-model-loading": "gemini",
};

const catalog: Record<string, ModelsDevModel[]> = {
    openai: [{ id: "gpt-4o-mini", name: "GPT-4o mini" }, { id: "gpt-4.1-mini", name: "GPT-4.1 mini" }],
    google: [{ id: "gemini-flash-lite-latest", name: "Gemini Flash-Lite" }, { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }],
    groq: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" }],
    openrouter: [{ id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" }],
    "opencode-go": [{ id: "kimi-k2.5", name: "Kimi K2.5" }],
};

const updateStates: Partial<Record<StateId, UpdateStatus["state"]>> = {
    "about-portable": "idle", "about-idle": "idle", "about-checking": "checking",
    "about-current": "current", "about-available": "available", "about-downloading": "downloading",
    "about-ready": "ready", "about-error": "error",
};

const releaseNotes = [
    "- **Playback controls.** Choose separate skip intervals for the left and right arrow keys.",
    "- **Subtitle timing.** Adjust subtitle sync during playback without leaving the player.",
    "- **Desktop updates.** Review the changes in your installed version from Settings.",
];

const longReleaseNotes = [
    ...releaseNotes,
    "- **Audio and subtitles.** Choose preferred languages and keep them across episodes.",
    "- **Subtitle appearance.** Adjust the size, position, weight, and color of captions.",
    "- **Episode continuation.** Play the next episode automatically when the current episode ends.",
    "- **Stream selection.** Review available streams and choose a different source from the player.",
    "- **HDR playback.** Configure display preferences on supported devices.",
    "- **Search.** Find movies, series, and people from the same search field.",
    "- **Settings navigation.** Related preferences are grouped into separate categories.",
    "- **Playback recovery.** Retry interrupted streams without losing your saved position.",
    "- **Keyboard controls.** Navigate player menus and settings using the keyboard.",
];

function fixtureBridge(id: StateId): DesktopBridge | undefined {
    const updates = isReleaseNotesState(id) ? "current" : updateStates[id];
    const nativePlayback = id.startsWith("playback-native");
    if (!updates && !nativePlayback && id !== "playback-mobile") return undefined;
    let status: UpdateStatus = {
        type: "update-status", version: installedVersion, state: updates ?? "idle",
        nextVersion: updates && ["available", "downloading", "ready"].includes(updates) ? releaseVersion : null,
        available: id !== "about-portable", automatic: true,
        message: id === "about-error" ? "Couldn’t download the update. Try again." : undefined,
    };
    const listeners = new Set<(message: NativeMessage) => void>();
    return {
        protocol: 1, platform: id === "playback-mobile" ? "ios" : id === "playback-native-custom" ? "windows" : "macos", fullscreen: false,
        capabilities: { updates: !!updates, nativeHdrPeak: id === "playback-native-auto" || id === "playback-native-custom" },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        send(request) {
            if (request.type === "update-automatic") status = { ...status, automatic: request.enabled };
            if (request.type === "update-check") {
                status = { ...status, state: status.state === "available" ? "ready" : "current", message: undefined };
            }
            if (["update-status", "update-automatic", "update-check"].includes(request.type)) {
                listeners.forEach(listener => listener(status));
            }
        },
    };
}

function fixtureStorage(id: StateId): Storage {
    const values = new Map<string, string>([[PLAYBACK_PREFERENCES_KEY, JSON.stringify(playback[id] ?? {})]]);
    if (id === "subtitles-custom") {
        values.set("navigator-subtitle-position", "18");
        values.set("navigator-subtitle-size", "large");
        values.set("navigator-subtitle-outline", "strong");
        values.set("navigator-subtitle-weight", "bold");
        values.set("navigator-subtitle-color", "warm-white");
    }
    if (providers[id]) values.set("navigator-ai-provider", providers[id]);
    if (id === "navigator-disabled") values.set("navigator-navigator-enabled", "false");
    if (id === "navigator-cerebras") values.set("navigator-cerebras-api-key", "fixture-cerebras-api-key");
    if (id.startsWith("navigator-chatgpt")) values.set("navigator-openai-auth-method", "chatgpt");
    if (["connections-personal", "connections-saving", "connections-save-error"].includes(id)) {
        values.set("navigator-tmdb-token", artworkToken);
    }
    if (id === "connections-personal") values.set("navigator-tinyfish-api-key", webSearchKey);
    return {
        get length() { return values.size; },
        clear: () => values.clear(),
        getItem: key => values.get(key) ?? null,
        key: index => [...values.keys()][index] ?? null,
        removeItem: key => { values.delete(key); },
        setItem: (key, value) => { values.set(key, String(value)); },
    };
}

const actions = {
    getArtwork: () => artwork.getArtworkSettings(),
    saveArtwork: () => artwork.saveArtworkToken(artworkToken),
    removeArtwork: () => artwork.removeArtworkToken(),
    setProvider: () => artwork.saveMetadataProvider("auto"),
    getSearch: () => webSearch.getWebSearchSettings(),
    saveSearch: () => webSearch.saveWebSearchKey(webSearchKey),
    removeSearch: () => webSearch.removeWebSearchKey(),
    setSearch: () => webSearch.setWebSearchEnabled(false),
};
type Action = keyof typeof actions;

export function installFixtures(id: StateId) {
    const previousFetch = window.fetch;
    const previousStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
    const previousBridge = Object.getOwnPropertyDescriptor(window, "navigatorDesktop");
    const storage = fixtureStorage(id);
    const teardown = new AbortController();
    Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
    Object.defineProperty(window, "navigatorDesktop", { configurable: true, value: fixtureBridge(id) });

    const pending = () => new Promise<Response>((_resolve, reject) => {
        teardown.signal.addEventListener("abort", () => reject(teardown.signal.reason), { once: true });
    });
    const flight = (value: unknown) => new Response(`0:${JSON.stringify({ a: value })}\n`, { headers: { "Content-Type": "text/x-component" } });
    const actionIds = new Map<string, Action>();
    let registering: Action | undefined;
    const personal = id === "connections-personal";
    const shared = id === "connections-shared";
    const artworkState: artwork.ArtworkSettingsState = { configured: personal || shared, personal, provider: personal ? "tmdb" : "auto" };
    const searchState = { configured: personal || shared || id.startsWith("navigator-search-"), personal, enabled: id !== "navigator-search-disabled" };

    function handleAction(action: Action, argument: unknown) {
        if (action === "getArtwork" || action === "getSearch") {
            if (id === "connections-loading") return pending();
            if (id === "connections-error") return new Response("Couldn’t load connection settings.", { status: 503 });
            return flight(action === "getArtwork" ? artworkState : searchState);
        }
        if (id === "connections-saving") return pending();
        if (id === "connections-save-error") return flight({ success: false, error: "Couldn’t verify this credential. Check it and try again." });
        switch (action) {
            case "saveArtwork": Object.assign(artworkState, { configured: true, personal: true }); break;
            case "removeArtwork": Object.assign(artworkState, { configured: shared, personal: false, provider: "auto" }); break;
            case "setProvider": artworkState.provider = argument as artwork.ArtworkSettingsState["provider"]; break;
            case "saveSearch": Object.assign(searchState, { configured: true, personal: true }); break;
            case "removeSearch": Object.assign(searchState, { configured: shared, personal: false }); break;
            case "setSearch": searchState.enabled = argument === true; break;
        }
        return flight({ success: true, ...(action.endsWith("Artwork") || action === "setProvider" ? artworkState : searchState) });
    }

    const chatGPTAccount = { email: "morgan@example.com", signedIn: true, planEnabled: id !== "navigator-chatgpt-permission" };
    let connection = id === "navigator-chatgpt-plan" || id === "navigator-chatgpt-permission" || id.startsWith("navigator-chatgpt-model-")
        ? chatGPTAccount : null;
    const mock = Object.assign(async (...args: Parameters<typeof previousFetch>) => {
        const [resource, init] = args;
        const url = new URL(resource instanceof Request ? resource.url : String(resource), window.location.href);
        if (url.origin !== location.origin) return previousFetch(resource, init);
        if (url.pathname === "/api/updates/release-notes") {
            if (id === "about-release-notes-loading") return pending();
            if (id === "about-release-notes-error") return Response.json({ notes: "" }, { status: 502 });
            if (id === "about-release-notes-empty") return Response.json({ notes: "" }, { status: 404 });
            if (url.searchParams.has("since")) return Response.json({ complete: true, releases: [
                { version: releaseVersion, notes: releaseNotes.join("\n") },
                { version: "0.6.12", notes: longReleaseNotes.slice(3, 6).join("\n") },
            ] });
            return Response.json({ notes: (id === "about-release-notes-long" ? longReleaseNotes : releaseNotes).join("\n") });
        }
        const actionId = new Headers(init?.headers).get("Next-Action");
        if (actionId && url.pathname === "/states/settings") {
            const [argument] = typeof init?.body === "string" ? JSON.parse(init.body) as unknown[] : [];
            if (argument && typeof argument === "object") return flight({ success: true, changed: false });
            const action = actionIds.get(actionId);
            if (action) return handleAction(action, argument);
            if (registering) {
                actionIds.set(actionId, registering);
                return flight(null);
            }
            return flight({ success: false, error: "This action has no workbench fixture." });
        }
        if (url.pathname === "/api/openai/models") {
            if (id === "navigator-model-error") return Response.json({ error: "Couldn’t reach the model provider." }, { status: 503 });
            return Response.json({ models: id === "navigator-model-empty" ? [] : catalog.openai });
        }
        if (url.pathname === "/api/models-dev/provider") {
            if (id === "navigator-model-loading") return pending();
            const provider = url.searchParams.get("providerId") ?? "";
            return Response.json({ provider: { id: provider, models: catalog[provider] ?? [] } });
        }
        if (url.pathname === "/api/cerebras/models") return Response.json({ models: ["gpt-oss-120b", "zai-glm-4.7"] });
        if (url.pathname === "/api/openai/chatgpt") {
            if (init?.method !== "POST") return Response.json({ available: true, connection, attempt: url.searchParams.has("attempt") ? { status: "pending" } : undefined });
            const { action, forget } = JSON.parse(String(init.body));
            if (action === "models") {
                if (id === "navigator-chatgpt-model-loading") return pending();
                if (id === "navigator-chatgpt-model-error") return Response.json({ error: "Couldn’t load ChatGPT models." }, { status: 503 });
                return Response.json({ models: catalog.openai });
            }
            if (action === "start") {
                if (id === "navigator-chatgpt-error") return Response.json({ error: "Couldn’t start ChatGPT sign-in. Try again." }, { status: 503 });
                return Response.json({ attemptId: "fixture-attempt", url: "#sign-in" });
            }
            if (action === "sign-out") connection = forget ? null : { ...chatGPTAccount, signedIn: false, planEnabled: false };
            return Response.json({ revoked: true });
        }
        return previousFetch(resource, init);
    }, previousFetch);
    window.fetch = mock;

    // Capture the generated IDs from the same action requests the panels use.
    // The fetch above fulfills every probe locally before the panels mount.
    const ready = (async () => {
        if (!id.startsWith("navigator-") && !id.startsWith("connections-")) return;
        for (const [action, probe] of Object.entries(actions)) {
            if (teardown.signal.aborted) return;
            registering = action as Action;
            await probe();
        }
        registering = undefined;
        if (actionIds.size !== Object.keys(actions).length) throw new Error("Settings action fixtures could not register.");
    })();

    return {
        ready,
        cleanup() {
            if (window.fetch === mock) window.fetch = previousFetch;
            if (previousStorage) Object.defineProperty(window, "localStorage", previousStorage);
            else Reflect.deleteProperty(window, "localStorage");
            if (previousBridge) Object.defineProperty(window, "navigatorDesktop", previousBridge);
            else Reflect.deleteProperty(window, "navigatorDesktop");
            teardown.abort();
        },
    };
}
