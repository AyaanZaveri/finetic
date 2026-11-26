import { Badge } from "@/components/ui/badge";
import type { ContentRating } from "@/lib/media/content-rating";

export function ContentRatingBadge({ rating, series = false }: { rating?: ContentRating; series?: boolean }) {
    if (!rating) return null;
    const label = `${rating.region} ${series ? "series " : ""}age rating: ${rating.value}`;
    return <Badge variant="outline" className="rounded-sm border-foreground/30 px-1.5" aria-label={label} title={label}>{rating.value}</Badge>;
}
