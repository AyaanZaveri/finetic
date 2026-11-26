import { notFound } from "next/navigation";
import { cinemetaHomeRows, hasTMDBDiscovery } from "@/lib/discovery";
import type { HomeCatalogSection } from "@/lib/home-catalogs";
import { loadHomeHeroItems } from "@/lib/server/home-hero";
import { getTMDBHomeRows } from "@/lib/tmdb-discovery";
import type { HomeHeroPublicData } from "./fixtures";
import HomeHeroWorkbench from "./workbench";

async function loadGuestHomeData(): Promise<HomeHeroPublicData> {
    try {
        const useTMDB = await hasTMDBDiscovery().catch(() => false);
        const featured = loadHomeHeroItems().catch(() => null);
        const rows = useTMDB ? getTMDBHomeRows().rows : cinemetaHomeRows();
        const settled = await Promise.allSettled(rows.map(row => row.result));
        const sections: HomeCatalogSection[] = settled.flatMap(entry =>
            entry.status === "fulfilled" && entry.value.status === "ready" && entry.value.section?.mediaItems.length
                ? [entry.value.section]
                : [],
        );
        const heroItems = await featured ?? [];
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
