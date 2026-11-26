import { notFound } from "next/navigation";
import { cinemetaHomeRows, hasTMDBDiscovery } from "@/lib/discovery";
import type { HomeCatalogSection } from "@/lib/home-catalogs";
import { selectHomeHeroItems } from "@/lib/home-hero";
import { enrichHomeHeroItems } from "@/lib/server/home-hero";
import { getMetadataProvider } from "@/lib/server/metadata-provider";
import { getTMDBHomeRows } from "@/lib/tmdb-discovery";
import type { HomeHeroPublicData } from "./fixtures";
import HomeHeroWorkbench from "./workbench";

async function loadGuestHomeData(): Promise<HomeHeroPublicData> {
    try {
        const [provider, useTMDB] = await Promise.all([
            getMetadataProvider().catch(() => "auto" as const),
            hasTMDBDiscovery().catch(() => false),
        ]);
        const rows = useTMDB ? getTMDBHomeRows().rows : cinemetaHomeRows();
        const settled = await Promise.allSettled(rows.map(row => row.result));
        const sections: HomeCatalogSection[] = settled.flatMap(entry =>
            entry.status === "fulfilled" && entry.value.status === "ready" && entry.value.section?.mediaItems.length
                ? [entry.value.section]
                : [],
        );
        const candidates = selectHomeHeroItems(
            sections.slice(0, 2).map(section => ({ items: section.mediaItems })),
            6,
        );
        const heroItems = await enrichHomeHeroItems(candidates, provider);
        return { heroItems, sections };
    } catch {
        return { heroItems: [], sections: [] };
    }
}

export default async function HomeHeroStatesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (process.env.NODE_ENV !== "development") notFound();
    const params = await searchParams;
    const isStage = params.__stage === "1";
    const publicData = isStage ? await loadGuestHomeData() : { heroItems: [], sections: [] };
    return <HomeHeroWorkbench publicData={publicData} />;
}
