"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { previewCrop } from "@/lib/media/preview-crop-client";
import { previewFrameSize } from "@/lib/media/preview-frames";

type Crop = { source: string; ratio: number; left: number; top: number; width: number; height: number };
const crops = new Map<string, Crop>();

export function PreviewLoadingIndicator() {
    return (
        <LoadingPlaceholder className="pointer-events-none absolute end-2 bottom-2 grid size-6 place-items-center rounded-full bg-black/55 text-white/85">
            <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
        </LoadingPlaceholder>
    );
}

/** Decode replacements before swapping; analyze letterbox bands off the UI thread. */
export function PreviewImage({ src, alt = "", pending = false, fallbackRatio }: {
    src: string; alt?: string; pending?: boolean; fallbackRatio?: number;
}) {
    const [current, setCurrent] = useState<Crop | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        const image = new Image();
        const analysis = crops.has(src) ? Promise.resolve(null) : previewCrop(src, controller.signal);
        image.src = src;
        let visible = false;
        let prepared = crops.get(src);
        const present = () => {
            if (controller.signal.aborted || !image.naturalWidth || !image.naturalHeight) return;
            visible = true;
            setCurrent(prepared || { source: src, ratio: image.naturalWidth / image.naturalHeight, left: 0, top: 0, width: 100, height: 100 });
        };
        // Keep the previous image until its replacement is decoded. Crop work
        // runs independently and cannot hold an otherwise ready frame hidden.
        if (image.decode) void image.decode().then(present).catch(() => {});
        else { image.onload = present; if (image.complete) present(); }
        void analysis.then(result => {
            if (!result || controller.signal.aborted) return;
            const { bounds, width, height } = result;
            prepared = { source: src, ratio: bounds.width / bounds.height,
                left: -bounds.x / bounds.width * 100, top: -bounds.y / bounds.height * 100,
                width: width / bounds.width * 100, height: height / bounds.height * 100 };
            crops.set(src, prepared);
            while (crops.size > 256) crops.delete(crops.keys().next().value!);
            if (visible) setCurrent(prepared);
        });
        return () => { controller.abort(); image.onload = null; image.removeAttribute("src"); };
    }, [src]);
    const busy = pending || current?.source !== src;
    return (
        <div aria-busy={busy} className="relative flex-none overflow-hidden rounded-lg" style={previewFrameSize(current?.ratio ?? fallbackRatio)}>
            <img
                src={current?.source} alt={pending || (current && current.source !== src) ? "Previous preview" : alt} draggable={false} decoding="async"
                className="absolute max-w-none"
                style={{ left: `${current?.left ?? 0}%`, top: `${current?.top ?? 0}%`, width: `${current?.width ?? 100}%`, height: `${current?.height ?? 100}%`, visibility: current ? "visible" : "hidden" }}
            />
            {!current && <div className="absolute inset-0 bg-white/10" />}
            {busy && <PreviewLoadingIndicator />}
        </div>
    );
}
