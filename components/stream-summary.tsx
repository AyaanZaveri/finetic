import { Star, Zap } from "lucide-react";
import type { StremioStream } from "@/types/stremio";
import { Badge } from "@/components/ui/badge";
import { getStreamPresentation } from "@/lib/media/stream-presentation";
import styles from "./media-actions.module.css";

export function StreamSummary({ stream, fallbackLabel }: { stream: StremioStream; fallbackLabel: string }) {
    const { resolution, source, lightning, stars, details } = getStreamPresentation(stream);
    const hasHeader = resolution || source || lightning;
    return (
        <>
            {hasHeader && (
                <span className={styles.streamName + " " + styles.streamMetadata}>
                    {resolution && <span>{resolution}</span>}
                    {lightning && (
                        <span role="img" aria-label="Lightning">
                            <Zap aria-hidden="true" className={styles.streamIcon + " " + styles.streamLightning} />
                        </span>
                    )}
                    {source && <Badge variant="secondary">{source}</Badge>}
                </span>
            )}
            {stars.length > 0 && (
                <span className={styles.streamStars} role="img" aria-label={stars.filter(Boolean).length + " of " + stars.length + " stars"}>
                    {stars.map((filled, index) => (
                        <Star key={index} aria-hidden="true" className={styles.streamIcon} fill={filled ? "currentColor" : "none"} />
                    ))}
                </span>
            )}
            {details.map((line, index) => (
                <span key={index} className={styles.streamTitle}>{line}</span>
            ))}
            {!hasHeader && stars.length === 0 && details.length === 0 && (
                <span className={styles.streamName}>{fallbackLabel}</span>
            )}
        </>
    );
}
