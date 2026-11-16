import { previewContentBounds } from "./preview-content";

const pending = new Map<number, AbortController>();
self.onmessage = async (event: MessageEvent<{ id: number; source?: string; cancel?: boolean }>) => {
    const { id, source, cancel } = event.data;
    if (cancel) { pending.get(id)?.abort(); return; }
    if (!source) return;
    const controller = new AbortController();
    pending.set(id, controller);
    let image: ImageBitmap | undefined;
    try {
        const response = await fetch(source, { credentials: "omit", signal: controller.signal });
        if (!response.ok) throw new Error("Preview image unavailable");
        image = await createImageBitmap(await response.blob());
        const scale = Math.min(448 / image.width, 1);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Preview canvas unavailable");
        if (controller.signal.aborted) return;
        context.drawImage(image, 0, 0, width, height);
        const bounds = previewContentBounds(context.getImageData(0, 0, width, height).data, width, height);
        if (!controller.signal.aborted) self.postMessage({ id, width, height, bounds });
    } catch {
        if (!controller.signal.aborted) self.postMessage({ id, bounds: null });
    } finally { image?.close(); pending.delete(id); }
};
