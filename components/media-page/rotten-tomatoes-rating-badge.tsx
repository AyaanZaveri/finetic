import { Badge } from "@/components/ui/badge";

export function RottenTomatoesRatingBadge({ score }: { score?: number }) {
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) return null;
    const label = `Rotten Tomatoes critics: ${score}%`;
    return (
        <Badge variant="secondary" aria-label={label} title={label}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={score >= 60 ? "/logo/tomatometer-fresh.svg" : "/logo/tomatometer-rotten.svg"}
                alt="" aria-hidden="true" width={14} height={14} className="size-3.5 shrink-0" />
            <span className="tabular-nums">{score}%</span>
        </Badge>
    );
}
