import { ProductionCompaniesSection } from "@/components/media-page/production-companies-section";
import { getTMDBProductionCompanies, type TMDBMediaType } from "@/lib/tmdb-discovery";

export async function ProductionCompanies({ id, type }: { id: string; type: TMDBMediaType }) {
    return <ProductionCompaniesSection companies={await getTMDBProductionCompanies(id, type)} />;
}
