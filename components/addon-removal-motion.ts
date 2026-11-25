import { motionTokens } from "./arc/motion-tokens";

const easing = `cubic-bezier(${motionTokens.ease.out.join(",")})`;

// A visual snapshot lives outside React and never contains interactive portals.
// Copy resolved styles so inherited tokens and container queries survive removal.
function snapshot(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;
    const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
    originals.forEach((element, index) => {
        const copy = copies[index];
        const computed = getComputedStyle(element);
        for (const property of computed) copy.style.setProperty(property, computed.getPropertyValue(property));
        copy.removeAttribute("id");
        copy.removeAttribute("autofocus");
        copy.style.animation = "none";
        copy.style.transition = "none";
        copy.style.pointerEvents = "none";
    });
    clone.inert = true;
    clone.setAttribute("aria-hidden", "true");
    return clone;
}

export function createAddonRemovalMotion(rows: Map<string, HTMLLIElement>, options?: {
    /** A rail can clip cards at its scroll viewport and wait for the removal commit. */
    clipTo?: () => HTMLElement | null;
    deferAttachment?: boolean;
}) {
    const animations = new Set<Animation>();
    let overlay: HTMLDivElement | undefined;
    let generation = 0;

    function cancel() {
        generation++;
        for (const animation of animations) animation.cancel();
        animations.clear();
        overlay?.remove();
        overlay = undefined;
    }

    function track(animation: Animation, done?: () => void) {
        animations.add(animation);
        void animation.finished.then(() => {
            animations.delete(animation);
            done?.();
        }, () => { animations.delete(animation); });
    }

    function prepare(id: string, enabled: boolean): (() => void) | undefined {
        if (!enabled) { cancel(); return; }
        // Measure active transforms before cancelling, so a second removal retargets.
        const elements = rows;
        const before = new Map([...elements].map(([key, element]) => [key, element.getBoundingClientRect()]));
        const source = elements.get(id);
        const rect = before.get(id);
        cancel();
        if (!source || !rect || typeof source.animate !== "function") return;
        const clip = options?.clipTo?.()?.getBoundingClientRect();
        if (clip && (rect.right <= clip.left || rect.left >= clip.right || rect.bottom <= clip.top || rect.top >= clip.bottom)) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const visual = snapshot(source);
        Object.assign(visual.style, {
            position: "absolute", left: `${rect.left - (clip?.left ?? 0)}px`, top: `${rect.top - (clip?.top ?? 0)}px`,
            width: `${rect.width}px`, height: `${rect.height}px`, margin: "0",
            transform: "none", pointerEvents: "none", boxSizing: "border-box",
        });
        const host = document.createElement("div");
        host.inert = true;
        host.setAttribute("aria-hidden", "true");
        Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "10" });
        if (clip) Object.assign(host.style, {
            inset: "auto", left: `${clip.left}px`, top: `${clip.top}px`,
            width: `${clip.width}px`, height: `${clip.height}px`, overflow: "hidden",
        });
        host.append(visual);
        if (!options?.deferAttachment) document.body.append(host);
        overlay = host;
        const transaction = generation;

        return () => {
            if (transaction !== generation) return;
            try {
                if (options?.deferAttachment) document.body.append(host);
                if (!reduced) for (const [key, element] of rows) {
                    const old = before.get(key);
                    if (!old) continue;
                    const next = element.getBoundingClientRect();
                    const dx = old.left - next.left;
                    const dy = old.top - next.top;
                    if (!dx && !dy) continue;
                    track(element.animate([
                        { transform: `translate(${dx}px, ${dy}px)` },
                        { transform: "translate(0px, 0px)" },
                    ], { duration: motionTokens.duration.standard * 1000, easing }));
                }
                track(visual.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
                    { opacity: 1, transform: "scale(1)" },
                    { opacity: 0, transform: "scale(0.98)" },
                ], {
                    duration: (reduced ? motionTokens.duration.instant : motionTokens.duration.fast) * 1000,
                    easing, fill: "forwards",
                }), () => {
                    host.remove();
                    if (overlay === host) overlay = undefined;
                });
            } catch { cancel(); } // Animation support must never affect a completed uninstall.
        };
    }

    return { prepare, cancel };
}
