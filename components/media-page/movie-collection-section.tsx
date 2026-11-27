import { MediaSection } from "@/components/media-section";
import type { MovieCollection } from "@/lib/tmdb-discovery";
import titleStyles from "./title-detail.module.css";

export function MovieCollectionSection({ collection }: { collection: MovieCollection | null }) {
    if (!collection?.parts.length) return null;
    return <div className={`${titleStyles.sectionGutter} ${titleStyles.recommendationRail} mt-6 px-4 md:px-10`}>
        <MediaSection sectionName={collection.name} landscape
            mediaItems={collection.parts.map(part => part.item)}
            cardBackdrops={collection.parts.map(part => part.backdrop)} />
    </div>;
}
