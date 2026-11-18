"use client";

import { useRouter } from "next/navigation";
import { CATALOG_ROW_HEIGHT, HomeCatalogSkeleton } from "@/components/home-catalog-skeleton";
import { useHomeSnapshot } from "@/components/home-snapshot-provider";
import { MediaSection } from "@/components/media-section";
import { HomeInitialPalette } from "@/components/home-palette-provider";
import { Button } from "@/components/ui/button";
import { mediaArtwork } from "@/lib/artwork";
import { INITIAL_CATALOG_COUNT, type HomeCatalogSection } from "@/lib/home-catalogs";

export function CachedCatalogRow({ section }: { section: HomeCatalogSection }) {
    const artwork = mediaArtwork(section.mediaItems[0] ?? {});
    return <div className="flow-root" style={{ minHeight: CATALOG_ROW_HEIGHT }}>
        <HomeInitialPalette primary={artwork.poster} fallback={artwork.background} />
        <MediaSection sectionName={section.sectionName} mediaItems={section.mediaItems} revealArtwork={false} />
    </div>;
}

export function HomeCatalogsPending() {
    const catalogs = useHomeSnapshot()?.catalogs ?? [];
    return <div data-home-initial-pending>
        {catalogs.length
            ? catalogs.map(({ data }) => <CachedCatalogRow key={data.key} section={data} />)
            : Array.from({ length: INITIAL_CATALOG_COUNT }, (_, index) => <HomeCatalogSkeleton key={index} />)}
    </div>;
}

export function HomeCatalogsUnavailable() {
    const catalogs = useHomeSnapshot()?.catalogs ?? [];
    const router = useRouter();
    return <>
        <section className="relative z-10 mb-4 flex items-center gap-3">
            <p role="status" className="text-sm text-muted-foreground">Could not refresh catalogs.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>Retry</Button>
        </section>
        {catalogs.map(({ data }) => <CachedCatalogRow key={data.key} section={data} />)}
    </>;
}
