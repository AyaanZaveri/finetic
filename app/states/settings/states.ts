import type { SettingsCategory } from "@/lib/settings-navigation";

export const groups = {
    playback: [
        ["playback-default", "Default arrow skip"],
        ["playback-custom", "Different skip amounts"],
        ["playback-minimum", "Minimum arrow skip"],
        ["playback-maximum", "Maximum arrow skip"],
        ["playback-webgpu-off", "WebGPU off"],
        ["playback-webgpu-decoding", "Browser decoding"],
        ["playback-web-hdr", "Web HDR enabled"],
        ["playback-mediaflow-off", "MediaFlow off"],
        ["playback-mediaflow-in-house", "MediaFlow in-house"],
        ["playback-mediaflow-custom-empty", "MediaFlow custom, empty"],
        ["playback-mediaflow-custom", "MediaFlow custom, configured"],
        ["playback-mediaflow-invalid", "MediaFlow invalid URL"],
        ["playback-native-basic", "Native HDR"],
        ["playback-native-auto", "Automatic native HDR peak"],
        ["playback-native-custom", "Custom native HDR peak"],
        ["playback-mobile", "Native mobile playback"],
    ],
    subtitles: [
        ["subtitles-default", "Default subtitles"],
        ["subtitles-enabled", "Subtitles on by default"],
        ["subtitles-forced", "Forced subtitles"],
        ["subtitles-custom", "Custom appearance"],
    ],
    navigator: [
        ["navigator-openai", "OpenAI"],
        ["navigator-anthropic", "Anthropic"],
        ["navigator-disabled", "Ask Navigator off"],
        ["navigator-gemini", "Gemini"],
        ["navigator-ollama", "Ollama"],
        ["navigator-groq", "Groq"],
        ["navigator-openrouter", "OpenRouter"],
        ["navigator-cerebras-no-key", "Cerebras without a key"],
        ["navigator-cerebras", "Cerebras"],
        ["navigator-opencode", "OpenCode Go"],
        ["navigator-model-loading", "Models loading"],
        ["navigator-model-checking", "Public catalog, checking model access"],
        ["navigator-model-filtered", "Models from API key"],
        ["navigator-model-empty", "No models available"],
        ["navigator-model-error", "Model load failed"],
        ["navigator-chatgpt", "ChatGPT signed out"],
        ["navigator-chatgpt-pending", "ChatGPT sign-in pending"],
        ["navigator-chatgpt-error", "ChatGPT sign-in failed"],
        ["navigator-chatgpt-plan", "ChatGPT plan connected"],
        ["navigator-chatgpt-permission", "ChatGPT plan permission needed"],
        ["navigator-chatgpt-model-loading", "ChatGPT models loading"],
        ["navigator-chatgpt-model-error", "ChatGPT model load failed"],
        ["navigator-search-enabled", "Web search enabled"],
        ["navigator-search-disabled", "Web search disabled"],
    ],
    connections: [
        ["connections-unconfigured", "No connections"],
        ["connections-shared", "Shared connections"],
        ["connections-personal", "Personal connections"],
        ["connections-loading", "Connections loading"],
        ["connections-error", "Connection load failed"],
        ["connections-saving", "Pending save"],
        ["connections-save-error", "Save failed"],
        ["connections-mdblist-empty", "MDBList · No key"],
        ["connections-mdblist-shared", "MDBList · Shared key"],
        ["connections-mdblist-personal", "MDBList · Saved key"],
        ["connections-mdblist-loading", "MDBList · Loading"],
        ["connections-mdblist-load-error", "MDBList · Load failed"],
        ["connections-mdblist-saving", "MDBList · Checking key"],
        ["connections-mdblist-save-error", "MDBList · Invalid key"],
        ["connections-mdblist-removing", "MDBList · Removing key"],
        ["connections-mdblist-saved", "MDBList · Key saved"],
        ["connections-mdblist-removed", "MDBList · Key removed"],
    ],
    about: [
        ["about-web", "Web version"],
        ["about-portable", "Updates unavailable"],
        ["about-idle", "Ready to check"],
        ["about-checking", "Checking for updates"],
        ["about-current", "Up to date"],
        ["about-available", "Update available"],
        ["about-downloading", "Downloading update"],
        ["about-ready", "Ready to restart"],
        ["about-error", "Update failed"],
        ["about-release-notes", "Release notes"],
        ["about-release-notes-long", "Long release notes"],
        ["about-release-notes-loading", "Release notes loading"],
        ["about-release-notes-empty", "No release notes"],
        ["about-release-notes-error", "Release notes failed"],
    ],
} as const satisfies Record<SettingsCategory, readonly (readonly [string, string])[]>;

export type StateId = typeof groups[SettingsCategory][number][0];

export function isReleaseNotesState(id: StateId) {
    return id.startsWith("about-release-notes");
}

export const states = (Object.keys(groups) as SettingsCategory[]).flatMap(category =>
    groups[category].map(([id, label]) => ({ category, id, label })));

export function readState(value: string | null) {
    return states.find(state => state.id === value) ?? states[0];
}

export function settingsStateHref(id: StateId) {
    return `/states/settings?__state=${id}`;
}
