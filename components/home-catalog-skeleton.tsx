import { Skeleton } from "@/components/ui/skeleton";
import rowStyles from "./media-section.module.css";

// Keep the bootstrap and streamed row fallbacks aligned with the virtualizer.
export const CATALOG_ROW_HEIGHT = 360;

export function HomeCatalogSkeleton() {
  return (
    <div aria-hidden="true" className="relative z-10 flow-root" style={{ minHeight: CATALOG_ROW_HEIGHT }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-56 rounded-full sm:h-8" />
        <div className="hidden items-center gap-2 md:flex">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
      <div className="overflow-hidden">
        <ul className={rowStyles.track}>
          {Array.from({ length: 16 }, (_, index) => (
            <li key={index} className="w-36 shrink-0">
              <Skeleton className="aspect-[2/3] w-full rounded-md" />
              <div className="px-1">
                <Skeleton className="mt-2.5 h-5 w-11/12 rounded" />
                <Skeleton className="mt-0.5 h-4 w-2/5 rounded" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
