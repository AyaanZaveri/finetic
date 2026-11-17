import { fetchCatalogItems } from "@/app/actions/media";
import { getInstalledAddons, getUser } from "@/app/actions/auth";
import { getTMDBHomeRows } from "@/lib/tmdb-discovery";
import { AuthErrorHandler } from "@/app/components/auth-error-handler";
import { HomeCatalogSectionsLazy } from "@/components/home-catalog-sections-lazy";
import { ContinueWatchingSection } from "@/components/home-continue-watching";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import type { HomeCatalogEntry, HomeCatalogSection, InitialHomeCatalog } from "@/lib/home-catalogs";
import { CATALOG_BATCH_SIZE, INITIAL_CATALOG_COUNT } from "@/lib/home-catalogs";
import type { StremioAddonCatalog } from "@/types/stremio";
import { Suspense } from "react";

function formatTypeLabel(type: string): string {
  return type
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCatalogLabel(catalogName: string | null, catalogId: string): string {
  const source = catalogName && catalogName.length > 0 ? catalogName : catalogId;
  return source
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function PosterCardSkeleton() {
  return (
    <div className="flex-shrink-0 w-36">
      <Skeleton className="w-full aspect-[2/3] rounded-md" />
      <div className="px-1 mt-2.5 space-y-1.5">
        <Skeleton className="h-4 w-11/12 rounded" />
        <Skeleton className="h-3 w-2/5 rounded" />
      </div>
    </div>
  );
}

function HomeSectionSkeleton() {
  const skeletonCount = 16;

  return (
    <LoadingPlaceholder className="relative z-10 mb-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        <Skeleton className="h-8 w-56 rounded-full" />
        <div className="flex items-center gap-2">
          <Skeleton className="hidden md:block size-8 rounded-full" />
          <Skeleton className="hidden md:block size-8 rounded-full" />
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: skeletonCount }).map((_, index) => (
          <PosterCardSkeleton key={`poster-card-skeleton-${index}`} />
        ))}
      </div>
    </LoadingPlaceholder>
  );
}

function HomeCatalogsFallback() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <HomeSectionSkeleton
          key={`home-catalog-loading-${index}`}
        />
      ))}
    </>
  );
}

async function buildCatalogEntries(): Promise<HomeCatalogEntry[]> {
  const addons = await getInstalledAddons();

  const catalogEntries = addons.flatMap((addon) =>
    (addon.manifest.catalogs || []).map((catalog: StremioAddonCatalog) => ({
      addonTransportUrl: addon.transportUrl,
      catalogId: catalog.id,
      catalogType: catalog.type,
      catalogName: catalog.name?.trim() || null,
    }))
  );

  return catalogEntries.map((entry, index) => {
    const typeLabel = formatTypeLabel(entry.catalogType);
    const catalogLabel = formatCatalogLabel(entry.catalogName, entry.catalogId);
    const sectionName =
      catalogLabel.toLowerCase() === typeLabel.toLowerCase()
        ? typeLabel
        : `${catalogLabel} • ${typeLabel}`;

    return {
      key: `${entry.addonTransportUrl}-${entry.catalogType}-${entry.catalogId}-${index}`,
      sectionName,
      catalogType: entry.catalogType,
      catalogId: entry.catalogId,
      addonTransportUrl: entry.addonTransportUrl,
    };
  });
}

async function loadCatalogSections(entries: HomeCatalogEntry[]): Promise<HomeCatalogSection[]> {
  const loadedSections = await Promise.all(
    entries.map(async (entry) => {
      const mediaItems = (
        await fetchCatalogItems(entry.catalogType, entry.catalogId, entry.addonTransportUrl, undefined, 12)
      ).slice(0, 12);

      if (mediaItems.length === 0) return null;

      return {
        key: entry.key,
        sectionName: entry.sectionName,
        mediaItems,
      } satisfies HomeCatalogSection;
    })
  );

  return loadedSections.filter(
    (section): section is HomeCatalogSection => section !== null
  );
}

async function CatalogSectionsBootstrap({
  catalogEntriesPromise,
}: {
  catalogEntriesPromise: Promise<HomeCatalogEntry[]>;
}) {
  const catalogEntries = await catalogEntriesPromise;
  if (catalogEntries.length === 0) return <DiscoverySections />;

  const initialEntries = catalogEntries.slice(0, INITIAL_CATALOG_COUNT);
  const remainingEntries = catalogEntries.slice(INITIAL_CATALOG_COUNT);
  const initialRows: InitialHomeCatalog[] = initialEntries.map(entry => ({
    key: entry.key, sectionName: entry.sectionName,
    retry: { catalog: entry },
    result: loadCatalogSections([entry]).then(sections => ({ status: "ready" as const, section: sections[0] ?? null }))
      .catch(() => ({ status: "error" as const })),
  }));

  return (
    <HomeCatalogSectionsLazy
      initialSections={[]}
      initialRows={initialRows}
      remainingEntries={remainingEntries}
      batchSize={CATALOG_BATCH_SIZE}
    />
  );
}

async function DiscoverySections() {
  const { rows, region } = getTMDBHomeRows();
  return <>
    <HomeCatalogSectionsLazy initialSections={[]} initialRows={rows} remainingEntries={[]} batchSize={CATALOG_BATCH_SIZE} />
    <p className="relative z-10 py-4 text-xs text-muted-foreground">
      Movie and TV data by <a draggable={false} href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="underline underline-offset-4">TMDB</a>.
      {" "}Streaming availability by <a draggable={false} href="https://www.justwatch.com" target="_blank" rel="noreferrer" className="underline underline-offset-4">JustWatch</a> ({region}).
    </p>
  </>;
}

export default async function Home() {
  const user = await getUser();
  const catalogEntriesPromise = user ? buildCatalogEntries() : null;

  return (
    <AuthErrorHandler>
      <div data-home-page className="relative px-[var(--page-gutter)] pt-3 pb-8 max-w-full overflow-hidden">
        <h1 className="sr-only">Home</h1>
        {user && <ContinueWatchingSection />}

        <Suspense fallback={<div data-home-initial-pending><HomeCatalogsFallback /></div>}>
          {catalogEntriesPromise ? <CatalogSectionsBootstrap catalogEntriesPromise={catalogEntriesPromise} /> : <DiscoverySections />}
        </Suspense>
      </div>
    </AuthErrorHandler>
  );
}
