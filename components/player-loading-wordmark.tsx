"use client";

import { useCallback, useState } from "react";
import { ArtworkImage } from "@/components/artwork-image";
import { artworkSampleUrl } from "@/lib/artwork";
import styles from "./player-loading-wordmark.module.css";

export function PlayerLoadingWordmark({ src, alt, loading }: {
    src: string;
    alt: string;
    loading: boolean;
}) {
    const [failure, setFailure] = useState<{ src: string; stage: "proxy" | "failed" } | null>(null);
    // Masks use the CORS-enabled image service; display can use TMDB directly.
    const maskSrc = artworkSampleUrl(src);
    const stage = failure?.src === src ? failure.stage : undefined;
    const imageSrc = stage === "proxy" ? maskSrc : src;
    const unavailable = useCallback(() => setFailure({ src, stage: !stage && maskSrc !== src ? "proxy" : "failed" }), [src, stage, maskSrc]);

    const maskImage = `url(${JSON.stringify(maskSrc)})`;

    return (
        <div className={styles.root} data-player-wordmark="" data-state={stage || "image"}>
            <div className={styles.logo} data-loading={loading || undefined}>
                {stage === "failed" ? <span className={styles.fallback}>{alt.replace(/ logo$/i, "")}</span> : <ArtworkImage
                    src={imageSrc}
                    fetchPriority="high"
                    decoding="async"
                    alt={alt}
                    draggable={false}
                    className={styles.image}
                    waitForDecode
                    fallbackText=""
                    onUnavailable={unavailable}
                />}
                {loading && stage !== "failed" && (
                    <span
                        aria-hidden="true"
                        className={styles.mask}
                        style={{ maskImage, WebkitMaskImage: maskImage }}
                    >
                        <span className={styles.sheen} />
                    </span>
                )}
            </div>
        </div>
    );
}
