"use client";

import { useCallback, useRef, useState } from "react";
import { ArtworkImage, ArtworkPlaceholder } from "@/components/artwork-image";
import styles from "./progressive-episode-still.module.css";

/** Keep cached card pixels underneath until the larger still has decoded. */
export function ProgressiveEpisodeStill({ preview, source, title }: { preview: string; source: string; title: string }) {
    const previewImage = useRef<HTMLImageElement | null>(null);
    const heroImage = useRef<HTMLImageElement | null>(null);
    const decoding = useRef<HTMLImageElement | null>(null);
    const finished = useRef(false);
    const [ready, setReady] = useState<{ animate: "first" | "upgrade" } | null>(null);
    const [failed, setFailed] = useState({ preview: false, hero: false });
    const finish = useCallback(async (image: HTMLImageElement) => {
        if (finished.current || decoding.current === image || !image.naturalWidth) return;
        decoding.current = image;
        try { if (typeof image.decode === "function") await image.decode(); } catch {
            if (!image.complete || !image.naturalWidth) {
                if (heroImage.current === image) setFailed(previous => ({ ...previous, hero: true }));
                return;
            }
        }
        if (heroImage.current !== image || decoding.current !== image || finished.current) return;
        finished.current = true;
        // When the sharp still is the first visible image, give it the full
        // artwork fade. A later quality upgrade only needs a short crossfade.
        setReady({ animate: previewImage.current?.dataset.artworkState === "ready" ? "upgrade" : "first" });
    }, []);
    const failPreview = useCallback(() => setFailed(previous => ({ ...previous, preview: true })), []);
    const attach = useCallback((image: HTMLImageElement | null) => {
        heroImage.current = image;
        if (image?.complete) {
            if (image.naturalWidth) void finish(image);
            else setFailed(previous => ({ ...previous, hero: true }));
        }
    }, [finish]);
    if (failed.preview && failed.hero) return <ArtworkPlaceholder className="h-full w-full" aria-label={`${title}: Artwork unavailable`} />;

    // Native images intentionally reuse the exact CDN/proxy URLs warmed by cards
    // and metadata. Next image optimization would create different cache entries.
    /* eslint-disable @next/next/no-img-element */
    return <div className={styles.surface} data-episode-hero-state={ready ? "sharp" : failed.hero ? "preview" : "loading"}
        role={failed.hero ? "img" : undefined} aria-label={failed.hero ? title : undefined}>
        <ArtworkImage ref={previewImage} src={preview} alt="" aria-hidden="true" decoding="async" waitForDecode
            className={styles.preview} data-failed={failed.preview || undefined} onUnavailable={failPreview} />
        <img ref={attach} src={source} alt={title} decoding="async" fetchPriority="high"
            className={styles.sharp} data-ready={Boolean(ready) || undefined} data-animate={ready?.animate || undefined}
            data-failed={failed.hero || undefined}
            onLoad={event => { void finish(event.currentTarget); }}
            onError={() => { decoding.current = null; setFailed(previous => ({ ...previous, hero: true })); }} />
    </div>;
    /* eslint-enable @next/next/no-img-element */
}
