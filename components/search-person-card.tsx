"use client";

import { IntentLink } from "@/components/intent-link";
import { ArtworkImage } from "@/components/artwork-image";
import type { SearchPersonItem } from "@/lib/search-presentation";

export function SearchPersonCard({ item }: { item: SearchPersonItem }) {
    return <IntentLink href={`/person/${item.id}`} className="group block min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <ArtworkImage src={item.poster} alt="" aria-hidden="true" width={300} height={450} loading="lazy" reveal="late"
            fallbackText="Photo unavailable" className="aspect-[2/3] w-full rounded-lg object-cover" />
        <div className="px-1">
            <div className="mt-2.5 break-words text-sm font-medium leading-snug text-foreground">{item.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{item.department || "Person"}</div>
        </div>
    </IntentLink>;
}
