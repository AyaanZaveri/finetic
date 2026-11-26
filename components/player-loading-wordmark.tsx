"use client";

import { useCallback, useState } from "react";
import { ArtworkImage } from "@/components/artwork-image";
import { artworkSampleUrl, publicArtworkUrl } from "@/lib/artwork";
import styles from "./player-loading-wordmark.module.css";

export function PlayerLoadingWordmark({ src, alt, loading }: {
    src: string;
    alt: string;
    loading: boolean;
}) {
    const [failure, setFailure] = useState<{ src: string; stage: "proxy" | "failed" } | null>(null);
    const proxySrc = artworkSampleUrl(src);
    const stage = failure?.src === src ? failure.stage : undefined;
    const imageSrc = stage === "proxy" ? proxySrc : src;
    const unavailable = useCallback(() => setFailure({ src, stage: !stage && proxySrc !== src ? "proxy" : "failed" }), [src, stage, proxySrc]);

    const [readySrc, setReadySrc] = useState<string | null>(null);
    const ready = useCallback(() => setReadySrc(imageSrc), [imageSrc]);
    // CSS masks fetch anonymously. Match the artwork request so both can
    // share the browser cache, then attach the mask after the image decodes.
    const crossOrigin = stage === "proxy" || publicArtworkUrl(src) ? "anonymous" : undefined;
    const maskImage = `url(${JSON.stringify(imageSrc)})`;

    return (
        <div className={styles.root} data-player-wordmark="" data-state={stage || "image"}>
            <div className={styles.logo} data-loading={loading || undefined}>
                {stage === "failed" ? <span className={styles.fallback}>{alt.replace(/ logo$/i, "")}</span> : <ArtworkImage
                    src={imageSrc}
                    fetchPriority="high"
                    decoding="async"
                    crossOrigin={crossOrigin}
                    alt={alt}
                    draggable={false}
                    className={styles.image}
                    waitForDecode
                    fallbackText=""
                    onReady={ready}
                    onUnavailable={unavailable}
                />}
                {loading && readySrc === imageSrc && stage !== "failed" && (
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
