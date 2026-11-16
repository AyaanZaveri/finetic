import type { PreviewBounds } from "./preview-content";

export type PreviewCrop = { width: number; height: number; bounds: PreviewBounds };
type Reply = PreviewCrop & { id: number };
let worker: Worker | undefined;
let sequence = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, (_reply: PreviewCrop | null) => void>();

function stop() {
    worker?.terminate(); worker = undefined;
    for (const finish of [...pending.values()]) finish(null);
}

/** Crop analysis is optional and never blocks presenting a decoded image. */
export function previewCrop(source: string, signal: AbortSignal): Promise<PreviewCrop | null> {
    if (signal.aborted || typeof Worker === "undefined") return Promise.resolve(null);
    clearTimeout(idle);
    try {
        if (!worker) {
            worker = new Worker(new URL("./preview-crop.worker.ts", import.meta.url), { type: "module" });
            worker.onmessage = (event: MessageEvent<Reply>) => {
                const reply = event.data;
                pending.get(reply.id)?.(reply.bounds ? reply : null);
            };
            worker.onerror = event => { event.preventDefault(); stop(); };
            worker.onmessageerror = stop;
        }
        const current = worker, id = ++sequence;
        return new Promise(resolve => {
            const finish = (reply: PreviewCrop | null) => {
                clearTimeout(timer); pending.delete(id); signal.removeEventListener("abort", cancel);
                resolve(reply);
                if (!pending.size) idle = setTimeout(stop, 30_000);
            };
            const cancel = () => { try { current.postMessage({ id, cancel: true }); } catch { /* The worker may already have stopped. */ } finish(null); };
            const timer = setTimeout(cancel, 4000);
            pending.set(id, finish);
            signal.addEventListener("abort", cancel, { once: true });
            try { current.postMessage({ id, source }); } catch { finish(null); }
        });
    } catch { return Promise.resolve(null); }
}
