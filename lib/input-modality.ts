/** Track actual input, including hover that programmatically moves menu focus.
 * Native WebViews and browsers use the same document and event path. */
export function installInputModality(document: Document): () => void {
    const root = document.documentElement;
    const pointer = () => {
        if (root.dataset.inputModality !== "pointer") root.dataset.inputModality = "pointer";
    };
    const keyboard = (event: KeyboardEvent) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        root.dataset.inputModality = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("pointermove", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
        document.removeEventListener("pointerdown", pointer, true);
        document.removeEventListener("pointermove", pointer, true);
        document.removeEventListener("keydown", keyboard, true);
        delete root.dataset.inputModality;
    };
}
