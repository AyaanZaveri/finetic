import { SeriesOverviewView } from "@/components/media-page/series-overview-view";
import { redirect } from "next/navigation";
import { getSeriesLayoutData } from "./_shared/series-data";

export default async function SeriesOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    const layoutData = await getSeriesLayoutData(id);

    if (!layoutData) {
      return <div className="p-4">Show not found</div>;
    }

    const { show, regularSeasonCount } = layoutData;

    return <SeriesOverviewView show={show} regularSeasonCount={regularSeasonCount} />;
  } catch (error: any) {
    if (error.message?.includes("Authentication expired")) {
      redirect("/login");
    }
    console.error("Error loading show overview:", error);
    return <div className="p-4">Couldn’t load this show. Reload to try again.</div>;
  }
}
