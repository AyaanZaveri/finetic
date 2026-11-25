import { PosterImage } from "@/components/media-page/poster-image";
import { MediaPlayButton } from "@/components/media-page/play-button";
import { Badge } from "@/components/ui/badge";
import { MediaRatingBadge } from "@/components/media-page/media-rating-badge";
import { redirect } from "next/navigation";
import { getSeriesLayoutData } from "./_shared/series-data";
import { formatReleaseDate } from "@/lib/format-release-date";

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

    return (
      <section aria-labelledby="series-title" className="@container">
        <div className="grid min-w-0 gap-6 @3xl:grid-cols-[14rem_minmax(0,1fr)] @3xl:items-center @3xl:gap-8">
          <div className="relative mx-auto w-[clamp(12rem,56vw,15rem)] max-w-full @3xl:mx-0 @3xl:w-full">
            <PosterImage
              movie={show}
              posterImage={show.poster || ""}
              className="w-full h-auto rounded-lg"
              width={500}
              height={750}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-6 text-start">
            <div className="flex min-w-0 flex-col items-center gap-3 text-center @3xl:items-start @3xl:text-start">
              <h1
                id="series-title"
                className="min-w-0 break-words text-3xl font-semibold leading-tight text-foreground text-balance @lg:text-4xl @5xl:text-5xl"
              >
                {show.name || ""}
              </h1>
              <div className="flex flex-wrap items-center justify-center gap-2 @3xl:justify-start">
                {(show.releaseInfo || show.year) && (
                  <Badge
                    variant="secondary"
                  >
                    {show.releaseInfo ? formatReleaseDate(show.releaseInfo) : show.year}
                  </Badge>
                )}
                <MediaRatingBadge media={show} />
                {regularSeasonCount > 0 && (
                  <Badge variant="secondary">
                    {regularSeasonCount} Season{regularSeasonCount !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <MediaPlayButton
                episodes={show.videos}
                media={{
                  id: show.id,
                  name: show.name,
                  type: "series",
                  seriesId: show.id,
                  showName: show.name,
                  backdropUrl: show.background || show.poster,
                }}
              />
            </div>

            {show.description && (
              <p className="max-w-prose whitespace-pre-line break-words text-base leading-relaxed">
                {show.description}
              </p>
            )}

            <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3 text-sm">
              {show.genres && show.genres.length > 0 && (
                <>
                  <dt className="font-medium text-muted-foreground">Genres</dt>
                  <dd className="flex min-w-0 flex-wrap gap-1.5">
                    {show.genres.map((genre) => (
                      <Badge
                        key={genre}
                        variant="secondary"
                        className="text-xs"
                      >
                        {genre}
                      </Badge>
                    ))}
                  </dd>
                </>
              )}
              {show.director && show.director.length > 0 && (
                <>
                  <dt className="font-medium text-muted-foreground">Director</dt>
                  <dd className="min-w-0 break-words font-normal">
                    {show.director.join(", ")}
                  </dd>
                </>
              )}
              {show.writer && show.writer.length > 0 && (
                <>
                  <dt className="font-medium text-muted-foreground">Writers</dt>
                  <dd className="min-w-0 break-words font-normal">
                    {show.writer.join(", ")}
                  </dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </section>
    );
  } catch (error: any) {
    if (error.message?.includes("Authentication expired")) {
      redirect("/login");
    }
    console.error("Error loading show overview:", error);
    return <div className="p-4">Couldn’t load this show. Reload to try again.</div>;
  }
}
