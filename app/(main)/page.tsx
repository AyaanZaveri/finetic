import { cinemetaHomeRows, hasTMDBDiscovery } from "@/lib/discovery";
import { getMetadataProvider } from "@/lib/server/metadata-provider";
import { fetchCatalogItems } from "@/app/actions/media";
import { getInstalledAddons, getUser } from "@/app/actions/auth";
import { getTMDBHomeRows, getTMDBWatchRegion } from "@/lib/tmdb-discovery";
import { AuthErrorHandler } from "@/app/components/auth-error-handler";
import { HomeCatalogSectionsLazy } from "@/components/home-catalog-sections-lazy";
import { ContinueWatchingSection } from "@/components/home-continue-watching";
import { HomeCatalogsPending, HomeCatalogsUnavailable } from "@/components/home-catalog-placeholder";
import { HomeFeatured, HomeHeroSkeleton } from "@/components/home-hero";
import { loadHomeHeroItems } from "@/lib/server/home-hero";
import { createHash } from "node:crypto";
import type { HomeCatalogEntry, HomeCatalogSection, InitialHomeCatalog } from "@/lib/home-catalogs";
import { CATALOG_BATCH_SIZE, INITIAL_CATALOG_COUNT } from "@/lib/home-catalogs";
import type { StremioAddonCatalog } from "@/types/stremio";
import { Suspense } from "react";
import homeStyles from "./home-page.module.css";

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

async function buildCatalogEntries(): Promise<HomeCatalogEntry[]> {
  const addons = await getInstalledAddons(true);

  const catalogEntries = addons.flatMap((addon) =>
    (addon.manifest.catalogs || []).map((catalog: StremioAddonCatalog) => ({
      addonTransportUrl: addon.transportUrl,
      catalogId: catalog.id,
      catalogType: catalog.type,
      catalogName: catalog.name?.trim() || null,
    }))
  );

  const seen = new Set<string>();
  return catalogEntries.flatMap(entry => {
    const typeLabel = formatTypeLabel(entry.catalogType);
    const catalogLabel = formatCatalogLabel(entry.catalogName, entry.catalogId);
    const sectionName =
      catalogLabel.toLowerCase() === typeLabel.toLowerCase()
        ? typeLabel
        : `${catalogLabel} • ${typeLabel}`;

    const key = "addon-" + createHash("sha256").update(JSON.stringify([
      entry.addonTransportUrl, entry.catalogType, entry.catalogId,
    ])).digest("hex");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      key,
      sectionName,
      catalogType: entry.catalogType,
      catalogId: entry.catalogId,
      addonTransportUrl: entry.addonTransportUrl,
    }];
  });
}

async function loadCatalogSections(entries: HomeCatalogEntry[]): Promise<HomeCatalogSection[]> {
  const loadedSections = await Promise.all(
    entries.map(async (entry) => {
      const mediaItems = (
        await fetchCatalogItems(entry.catalogType, entry.catalogId, entry.addonTransportUrl, undefined, 12, true)
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

type DiscoveryPlan =
  | { source: "cinemeta"; rows: InitialHomeCatalog[]; available: Promise<boolean> }
  | { source: "tmdb"; rows: InitialHomeCatalog[]; region: string };

type HomeDataPlan =
  | {
      kind: "addons";
      initialRows: InitialHomeCatalog[];
      remainingEntries: HomeCatalogEntry[];
      discovery: DiscoveryPlan | null;
    }
  | {
      kind: "discovery";
      discovery: DiscoveryPlan;
    };

async function buildDiscoveryPlan(): Promise<DiscoveryPlan> {
  if (!await hasTMDBDiscovery()) {
    const rows = cinemetaHomeRows();
    const available = Promise.all(rows.map(row => row.result)).then(results => results.some(result => result.status !== "error"));
    return { source: "cinemeta", rows, available };
  }
  const { rows, region } = getTMDBHomeRows();
  return { source: "tmdb", rows, region };
}

async function prepareHomeData(
  catalogEntriesPromise: Promise<HomeCatalogEntry[] | null> | null,
): Promise<HomeDataPlan> {
  const catalogEntries = catalogEntriesPromise ? await catalogEntriesPromise : null;
  if (!catalogEntries?.length) {
    return { kind: "discovery", discovery: await buildDiscoveryPlan() };
  }

  const preferredProvider = await getMetadataProvider();
  const initialEntries = catalogEntries.slice(0, INITIAL_CATALOG_COUNT);
  const remainingEntries = catalogEntries.slice(INITIAL_CATALOG_COUNT);
  const initialRows: InitialHomeCatalog[] = initialEntries.map(entry => ({
    key: entry.key, sectionName: entry.sectionName,
    retry: { catalog: entry },
    result: loadCatalogSections([entry]).then(sections => ({ status: "ready" as const, section: sections[0] ?? null }))
      .catch(() => ({ status: "error" as const })),
  }));
  const discovery = preferredProvider !== "auto" ? await buildDiscoveryPlan() : null;

  return { kind: "addons", initialRows, remainingEntries, discovery };
}

async function DiscoverySections({ discovery }: { discovery: DiscoveryPlan }) {
  if (discovery.source === "cinemeta" && !await discovery.available) return <HomeCatalogsUnavailable />;
  return <HomeCatalogSectionsLazy initialSections={[]} initialRows={discovery.rows} remainingEntries={[]} batchSize={CATALOG_BATCH_SIZE} />;
}

async function DiscoveryAttribution({ discovery }: { discovery: { source: "cinemeta"; available: Promise<boolean> } | { source: "tmdb"; region: string } }) {
  if (discovery.source === "cinemeta") {
    if (!await discovery.available) return null;
    return <footer className={homeStyles.attribution}>Movie and TV data by <span className={homeStyles.attributionProvider}>Cinemeta</span></footer>;
  }
  return <footer className={homeStyles.attribution}>
    Movie and TV data by <a draggable={false} href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" className={homeStyles.attributionLink}>TMDB</a>.
    {" "}Streaming availability by <a draggable={false} href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer" className={homeStyles.attributionLink}>JustWatch</a> ({discovery.region}).
  </footer>;
}

async function FeaturedAttribution() {
  const discovery = await hasTMDBDiscovery()
    ? { source: "tmdb" as const, region: getTMDBWatchRegion() }
    : { source: "cinemeta" as const, available: Promise.resolve(true) };
  return <DiscoveryAttribution discovery={discovery} />;
}

async function HomeCatalogsBootstrap({ getPlan }: { getPlan: () => Promise<HomeDataPlan> }) {
  const plan = await getPlan();
  const { discovery } = plan;
  return <>
    {discovery && <DiscoverySections discovery={discovery} />}
    {plan.kind === "addons" && <HomeCatalogSectionsLazy
      initialSections={[]}
      initialRows={plan.initialRows}
      remainingEntries={plan.remainingEntries}
      batchSize={CATALOG_BATCH_SIZE}
    />}
    {discovery ? <DiscoveryAttribution discovery={discovery} /> : <FeaturedAttribution />}
  </>;
}

export default async function Home() {
  const user = await getUser();
  const catalogEntriesPromise = user ? buildCatalogEntries().catch(() => null) : null;
  let planPromise: Promise<HomeDataPlan> | null = null;
  const getPlan = () => {
    if (!planPromise) {
      planPromise = prepareHomeData(catalogEntriesPromise);
    }
    return planPromise;
  };

  return (
    <AuthErrorHandler>
      <div data-home-page className={homeStyles.page}>
        <h1 className="sr-only">Home</h1>
        <Suspense fallback={<HomeHeroSkeleton />}>
          <HomeFeatured items={loadHomeHeroItems().catch(() => null)} />
        </Suspense>
        <div className={homeStyles.rows}>
          {user && <ContinueWatchingSection />}

          <Suspense fallback={<HomeCatalogsPending />}>
            <HomeCatalogsBootstrap getPlan={getPlan} />
          </Suspense>
        </div>
      </div>
    </AuthErrorHandler>
  );
}
