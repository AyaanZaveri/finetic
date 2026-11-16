type Media = Pick<HTMLMediaElement, "paused" | "ended" | "error" | "addEventListener" | "removeEventListener">;
type Sentinel = Pick<WakeLockSentinel, "released" | "release" | "addEventListener">;
type Environment = {
    document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
    window?: Pick<Window, "addEventListener" | "removeEventListener">;
    wakeLock?: { request(_type: "screen"): Promise<Sentinel> };
};

/** Best effort: browser power policy and visibility can deny or revoke a lock. */
export function keepPlaybackAwake(media: Media, environment: Environment = {
    document, window, wakeLock: navigator.wakeLock,
}): () => void {
    const { document: page, window: view, wakeLock } = environment;
    if (!wakeLock) return () => {};
    let disposed = false, pageActive = true, pending = false, revision = 0;
    let running = !media.paused && !media.ended && !media.error;
    let held: Sentinel | undefined;
    const wanted = () => !disposed && pageActive && running && !media.paused && !media.ended && !media.error && page.visibilityState === "visible";
    const release = (sentinel: Sentinel | undefined) => { if (sentinel && !sentinel.released) void sentinel.release().catch(() => {}); };
    const reconcile = () => {
        if (!wanted()) { const previous = held; held = undefined; release(previous); return; }
        if (held?.released) held = undefined;
        if (held || pending) return;
        pending = true;
        const started = revision;
        void (async () => {
            try {
                const sentinel = await wakeLock.request("screen");
                if (!wanted()) { release(sentinel); return; }
                held = sentinel;
                sentinel.addEventListener("release", () => { if (held === sentinel) held = undefined; }, { once: true });
            } catch { /* Unsupported contexts, battery policy and denial never block playback. */ }
            finally {
                pending = false;
                // A hide/pause and return may happen while acquisition is pending.
                // Retry that changed intent once, never spin on a denied request.
                if (wanted() && revision !== started && !held) reconcile();
            }
        })();
    };
    const update = () => { revision++; reconcile(); };
    const play = () => { running = true; update(); };
    const stop = () => { running = false; update(); };
    const hide = () => { pageActive = false; update(); };
    const show = () => { pageActive = true; update(); };
    for (const event of ["play", "playing"]) media.addEventListener(event, play);
    for (const event of ["pause", "ended", "error", "emptied", "loadstart"]) media.addEventListener(event, stop);
    page.addEventListener("visibilitychange", update);
    view?.addEventListener("pagehide", hide);
    view?.addEventListener("pageshow", show);
    reconcile();
    return () => {
        disposed = true; update();
        for (const event of ["play", "playing"]) media.removeEventListener(event, play);
        for (const event of ["pause", "ended", "error", "emptied", "loadstart"]) media.removeEventListener(event, stop);
        page.removeEventListener("visibilitychange", update);
        view?.removeEventListener("pagehide", hide);
        view?.removeEventListener("pageshow", show);
    };
}
