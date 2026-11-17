/** Buttons can contain natively draggable images or links, including in portals. */
export function installButtonDragPrevention(document: Document): () => void {
    const prevent = (event: DragEvent) => {
        if (event.target instanceof Element && event.target.closest('button, [role="button"], [data-slot="button"]')) {
            event.preventDefault();
        }
    };
    document.addEventListener("dragstart", prevent, true);
    return () => document.removeEventListener("dragstart", prevent, true);
}
