import type { DesktopBridge, NativeMessage, UpdateStatus } from "@/lib/desktop/bridge";

export const groups = [
    { label: "Update", items: [
        { id: "idle", label: "Check for updates" },
        { id: "checking", label: "Checking for updates" },
        { id: "available", label: "Update available" },
        { id: "downloading", label: "Downloading update" },
        { id: "ready", label: "Restart to update" },
        { id: "installing", label: "Restarting Navigator" },
        { id: "current", label: "Up to date" },
        { id: "error", label: "Update error" },
    ] },
    { label: "Availability", items: [
        { id: "unsupported", label: "In-app updates unavailable" },
        { id: "web", label: "Web app" },
    ] },
] as const;

export type StateId = typeof groups[number]["items"][number]["id"];
export const states = groups.flatMap(group => [...group.items] as { id: StateId; label: string }[]);
export const installedVersion = "0.6.10";
export const releaseVersion = "0.6.13";
export function installUpdateFixture(id: StateId, onInstall: () => void) {
    if (id === "web") return () => {};
    const listeners = new Set<(_message: NativeMessage) => void>();
    let status: UpdateStatus = {
        type: "update-status",
        version: id === "current" ? releaseVersion : installedVersion,
        nextVersion: ["available", "downloading", "ready", "installing"].includes(id) ? releaseVersion : null,
        available: id !== "unsupported",
        automatic: id !== "available",
        state: id === "unsupported" ? "idle" : id,
        message: id === "error" ? "Couldn’t check for updates. Try again." : undefined,
    };
    const bridge: DesktopBridge = {
        protocol: 1,
        platform: "macos",
        capabilities: { updates: true, updateReview: true },
        fullscreen: false,
        send(request) {
            switch (request.type) {
                case "update-check":
                    if (request.intent === "install" && status.state === "ready") onInstall();
                    else if (request.intent === "prepare" && !["ready", "checking", "downloading", "installing"].includes(status.state)) {
                        status = { ...status, state: status.state === "available" ? "downloading" : "checking", message: undefined };
                    }
                    break;
                case "update-automatic":
                    status = { ...status, automatic: request.enabled };
                    break;
                case "update-status":
                    break;
                default:
                    return;
            }
            listeners.forEach(listener => listener(status));
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
    Object.defineProperty(window, "navigatorDesktop", { value: bridge, configurable: true });
    return () => {
        listeners.clear();
        if (window.navigatorDesktop === bridge) Reflect.deleteProperty(window, "navigatorDesktop");
    };
}
