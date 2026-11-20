import { Play, Star, Zap } from "lucide-react";
import type { StremioStream } from "@/types/stremio";
import { Badge } from "@/components/ui/badge";
import { getStreamPresentation } from "@/lib/media/stream-presentation";
import styles from "./media-actions.module.css";

export function StreamSummary({ stream, fallbackLabel, current }: { stream: StremioStream; fallbackLabel: string; current?: boolean }) {
    const { resolution, source, lightning, stars, details } = getStreamPresentation(stream);
    const hasHeader = resolution || source || lightning;
    const currentIcon = current && <Play aria-hidden="true" className="inline-block size-3 shrink-0 fill-current align-baseline text-foreground/75" />;
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
                    {currentIcon}
                </span>
            )}
            {stars.length > 0 && (
                <span className={styles.streamStars} role="img" aria-label={stars.filter(Boolean).length + " of " + stars.length + " stars"}>
                    {stars.map((filled, index) => (
                        <Star key={index} aria-hidden="true" className={styles.streamIcon} fill={filled ? "currentColor" : "none"} />
                    ))}
                    {!hasHeader && currentIcon}
                </span>
            )}
            {details.map((line, index) => (
                <span key={index} className={styles.streamTitle}>{line}{!hasHeader && stars.length === 0 && index === 0 && currentIcon && (
                    <>{"\u00a0"}{currentIcon}</>
                )}</span>
            ))}
            {!hasHeader && stars.length === 0 && details.length === 0 && (
                <span className={styles.streamName}>{fallbackLabel}{currentIcon && <>{"\u00a0"}{currentIcon}</>}</span>
            )}
        </>
    );
}
