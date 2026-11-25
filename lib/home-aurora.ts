import type { HomeArtwork } from "./home-palette";

const cardSelector = "[data-home-aurora-card]";

export function homeAuroraArtwork(element: Element | null): HomeArtwork | null {
    const primary = element?.getAttribute("data-aurora-primary") || undefined;
    const fallback = element?.getAttribute("data-aurora-fallback") || undefined;
    return primary || fallback ? { primary, fallback } : null;
}

/** Select the artwork at the leading visible edge, not the first mounted
 * virtual row. The header covers part of the page scrollport. */
export function homeAuroraBase(page: HTMLElement, viewport: HTMLElement, header: HTMLElement | null): HomeArtwork | null {
    const bounds = viewport.getBoundingClientRect();
    const top = Math.max(bounds.top, header?.getBoundingClientRect().bottom ?? bounds.top);
    const bottom = bounds.bottom;
    const hero = page.querySelector<HTMLElement>("[data-home-hero]");
    if (hero) {
        const rect = hero.getBoundingClientRect();
        const artwork = homeAuroraArtwork(hero);
        if (artwork && rect.top <= top + 16 && rect.bottom > top + 16) return artwork;
    }

    const rows = Array.from(page.querySelectorAll<HTMLElement>("[data-media-row-viewport]"))
        .map(row => ({ row, rect: row.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom > top + 16 && rect.top < bottom)
        .sort((a, b) => a.rect.top - b.rect.top);
    for (const { row, rect } of rows) {
        const left = Math.max(bounds.left, rect.left);
        const right = Math.min(bounds.right, rect.right);
        const cards = Array.from(row.querySelectorAll<HTMLElement>(cardSelector))
            .map(card => ({ card, rect: (card.querySelector<HTMLElement>("[data-home-aurora-artwork]") ?? card).getBoundingClientRect() }))
            .filter(({ rect }) => rect.right > left + 8 && rect.left < right && rect.bottom > top + 16 && rect.top < bottom)
            .sort((a, b) => a.rect.left - b.rect.left);
        for (const { card } of cards) {
            const artwork = homeAuroraArtwork(card);
            if (artwork) return artwork;
        }
    }
    return null;
}

/** Publish only the current intent. A debounced hover temporarily overrides
 * the scrolling base, and an obsolete image/worker result cannot repaint it. */
export function createHomeAuroraSelection(
    load: (_primary?: string, _fallback?: string) => Promise<string[] | null>,
    publish: (_colors: string[]) => void,
    clock = {
        set: (callback: () => void, delay: number) => setTimeout(callback, delay),
        clear: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
    },
) {
    let base: HomeArtwork | null = null;
    let hover: HomeArtwork | null = null;
    let focus: HomeArtwork | null = null;
    let desired = "", displayed = "", revision = 0;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function reconcile(delay: number) {
        if (disposed) return;
        const source = hover ?? focus ?? base;
        const key = source ? JSON.stringify([source.primary, source.fallback]) : "";
        if (key === desired) return;
        desired = key;
        const token = ++revision;
        clock.clear(timer);
        timer = undefined;
        if (!source || key === displayed) return;
        const request = () => {
            timer = undefined;
            void load(source.primary, source.fallback).then(colors => {
                if (!disposed && token === revision && colors?.length) {
                    displayed = key;
                    publish(colors);
                }
            }).catch(() => {});
        };
        if (delay) timer = clock.set(request, delay);
        else request();
    }

    return {
        setBase(source: HomeArtwork | null, immediate = false) { base = source; reconcile(immediate ? 0 : 90); },
        setHover(source: HomeArtwork | null) { hover = source; reconcile(source ? 90 : 0); },
        setFocus(source: HomeArtwork | null) { focus = source; reconcile(0); },
        scroll(source: HomeArtwork | null) {
            base = source;
            hover = focus = null;
            reconcile(90);
        },
        dispose() { disposed = true; revision++; clock.clear(timer); timer = undefined; },
    };
}
