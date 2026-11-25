import titleStyles from "@/components/media-page/title-detail.module.css";
import backdropStyles from "@/components/media-page/backdrop-transition.module.css";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { Skeleton } from "@/components/ui/skeleton";

export function MediaDetailsLoading() {
  return (
    <div
      role="status"
      aria-label="Loading media details"
      className={`${backdropStyles.page} ${titleStyles.loadingPage} min-h-screen overflow-hidden pb-8`}
    >
      <span className="sr-only">Loading media details…</span>
      <div aria-hidden="true" className={`${backdropStyles.hero} ${titleStyles.hero} w-full`} />
      <div className={`${backdropStyles.content} ${titleStyles.content} relative px-4 pb-6 md:mx-4 md:px-6`}>
        <LoadingPlaceholder className="@container">
          <div className="grid min-w-0 gap-6 @3xl:grid-cols-[14rem_minmax(0,1fr)] @3xl:items-start @3xl:gap-8">
            <div className={`${titleStyles.poster} mx-auto aspect-[2/3] w-[clamp(12rem,56vw,15rem)] max-w-full rounded-lg bg-muted/30 @3xl:mx-0 @3xl:w-full`} />
            <div className="flex min-w-0 flex-col gap-6 @3xl:pt-3">
              <div className={`${titleStyles.identity} flex flex-col items-center gap-3 @3xl:items-start`}>
                <Skeleton className="h-12 w-3/4" />
                <Skeleton className="h-6 w-40 max-w-full" />
                <div className={titleStyles.loadingActions}>
                  <Skeleton className="h-12 flex-1 rounded-full" />
                  <Skeleton className="size-12 rounded-full" />
                </div>
              </div>
              <Skeleton className="h-24 w-full max-w-prose" />
              <Skeleton className="h-28 w-full max-w-prose" />
            </div>
          </div>
        </LoadingPlaceholder>
      </div>
    </div>
  );
}
