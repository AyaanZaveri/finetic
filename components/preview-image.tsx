"use client";

import { useEffect, useState } from "react";
import { previewCrop } from "@/lib/media/preview-crop-client";

type Crop = { source: string; ratio: number; left: number; top: number; width: number; height: number };
const crops = new Map<string, Crop>();

/** Decode replacements before swapping; analyze letterbox bands off the UI thread. */
export function PreviewImage({ src, alt = "", pending = false }: { src: string; alt?: string; pending?: boolean }) {
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
    // Decoder dimensions and letterbox analysis must never grow the tooltip.
    const ratio = current?.ratio && Number.isFinite(current.ratio) ? current.ratio : 16 / 9;
    const width = Math.min(100, ratio / (16 / 9) * 100);
    const height = Math.min(100, (16 / 9) / ratio * 100);
    const busy = pending || current?.source !== src;
    return (
        <div aria-busy={busy} className="relative w-56 overflow-hidden rounded-lg" style={{ width: 224, height: 126, flex: "none" }}>
            <img
                src={current?.source} alt={pending || (current && current.source !== src) ? "Previous preview" : alt} draggable={false} decoding="async"
                className="absolute max-w-none"
                style={{ left: `${(100 - width) / 2 + (current?.left ?? 0) * width / 100}%`, top: `${(100 - height) / 2 + (current?.top ?? 0) * height / 100}%`, width: `${(current?.width ?? 100) * width / 100}%`, height: `${(current?.height ?? 100) * height / 100}%`, visibility: current ? "visible" : "hidden" }}
            />
            {!current && <div className="absolute inset-0 bg-white/10" />}
            {current && busy && <div aria-hidden="true" className="pointer-events-none absolute inset-0 animate-pulse bg-white/5 motion-reduce:animate-none" />}
        </div>
    );
}
