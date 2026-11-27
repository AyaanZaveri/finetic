import { Skeleton } from "@/components/ui/skeleton";
import cardStyles from "./media-card.module.css";
import rowStyles from "./media-section.module.css";

/** Static, non-interactive placeholders share the actual card frame and rail. */
export function MediaSectionSkeleton({ sectionName, continueWatching = false }: {
  sectionName?: string;
  continueWatching?: boolean;
}) {
  return (
    <section aria-label={sectionName} aria-busy={sectionName ? true : undefined} className="relative z-10 mb-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        {sectionName ? (
          <h2 className="min-w-0 text-xl sm:text-2xl font-semibold text-foreground font-poppins">{sectionName}</h2>
        ) : (
          <div className={`${rowStyles.skeletonHeading} flex items-center`} aria-hidden="true">
            <Skeleton animated={false} className={`${rowStyles.skeletonHeadingText} rounded-full`} />
          </div>
        )}
      </div>
      <div className={rowStyles.viewport} aria-hidden="true" data-media-skeleton-viewport="">
        <ul className={rowStyles.track}>
          {Array.from({ length: continueWatching ? 8 : 16 }, (_, index) => (
            <li key={index} className="flex-shrink-0">
              <div data-media-skeleton-card="" className={`${cardStyles.card} ${cardStyles.skeletonCard} relative ${continueWatching ? "w-80" : "w-36"}`}>
                <div data-media-skeleton-frame="" className={`${cardStyles.surface} relative w-full ${continueWatching ? "aspect-video" : "aspect-[2/3]"}`}>
                  <div className={`${cardStyles.frame} absolute inset-0 overflow-hidden`} />
                </div>
                <div className="px-1">
                  <div className="mt-2.5 flex h-5 items-center">
                    <Skeleton animated={false} data-media-skeleton-title="" className="h-3.5 w-3/4 rounded-full" />
                  </div>
                  <div className="mt-0.5 flex h-4 items-center">
                    <Skeleton animated={false} data-media-skeleton-subtitle="" className="h-2.5 w-2/5 rounded-full" />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
