export interface CarouselPosition { overflow: boolean; start: boolean; end: boolean }

/** Recheck both the viewport and track when cards or available width change. */
export function observeCarouselControls(viewport: HTMLElement, update: (_position: CarouselPosition) => void) {
    const measure = () => {
        const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
        const offset = Math.abs(viewport.scrollLeft);
        update({ overflow: maximum > 1, start: offset <= 1, end: offset >= maximum - 1 });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(viewport);
    if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
    viewport.addEventListener("scroll", measure, { passive: true });
    // ResizeObserver is unavailable in a few embedded clients.
    window.addEventListener("resize", measure);
    measure();
    return () => {
        observer?.disconnect();
        viewport.removeEventListener("scroll", measure);
        window.removeEventListener("resize", measure);
    };
}
