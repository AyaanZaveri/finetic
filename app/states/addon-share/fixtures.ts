import type { AddonShareState } from "@/components/addon-share-content";
import type { AddonListItem } from "@/lib/addons";

export const groups = [
    { title: "Share link", states: [
        { id: "ready", label: "Ready to share" },
        { id: "configured", label: "Configured addon" },
        { id: "no-logo", label: "Addon without artwork" },
        { id: "loading", label: "Loading link" },
        { id: "unavailable", label: "Link unavailable" },
    ] },
    { title: "Clipboard", states: [
        { id: "copying", label: "Copying link" },
        { id: "copied", label: "Link copied" },
        { id: "copy-error", label: "Clipboard unavailable" },
    ] },
] as const;
export const states = groups.flatMap(group => [...group.states]);
export type StateId = (typeof states)[number]["id"];
export const readState = (id: unknown): StateId => states.find(state => state.id === id)?.id ?? "ready";

export function fixture(id: StateId): { addon: AddonListItem; share: AddonShareState } {
    const configured = id === "configured";
    const addon: AddonListItem = {
        id: "demo.catalogs:0",
        name: configured ? "Streaming Catalogs" : "Stremio Catalogs",
        version: "1.4.2",
        description: configured ? "Browse movie and TV catalogs from the services you use." : "Discover popular movies and series in curated categories.",
        logo: id === "no-logo" ? undefined : "/logo/stremio.svg",
        capabilities: ["catalog", "meta"],
        types: ["movie", "series"],
        catalogCount: 6,
        configurable: configured,
        protected: false,
    };
    const url = configured ? "https://catalogs.example.com/configured-demo/manifest.json" : "https://catalogs.example.com/manifest.json";
    switch (id) {
    case "loading": return { addon, share: { kind: "loading" } };
    case "unavailable": return { addon, share: { kind: "unavailable", message: "Could not load the addon link. Close this dialog and try again." } };
    case "copying": return { addon, share: { kind: "copying", url } };
    case "copy-error": return { addon, share: { kind: "copy-error", url, message: "Could not copy automatically. Select the link and copy it manually." } };
    default: return { addon, share: { kind: "ready", url } };
    }
}
