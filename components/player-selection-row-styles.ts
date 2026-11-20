import artworkStyles from "@/components/media-page/detail-artwork.module.css";
import cardStyles from "@/components/media-card.module.css";
import drawerStyles from "@/components/player-selection-controls.module.css";

export const selectionListClass = "-mx-[6px] space-y-2 py-1";
export const selectionRowLayout = "flex items-center gap-4 rounded-lg p-2";
export const selectionRowClass = `${selectionRowLayout} ${drawerStyles.row} relative w-full text-start outline-none select-none aria-[current=true]:after:pointer-events-none aria-[current=true]:after:absolute aria-[current=true]:after:inset-0 aria-[current=true]:after:rounded-[inherit] aria-[current=true]:after:border-2 aria-[current=true]:after:border-primary enabled:cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 motion-safe:transition-[background-color,scale] motion-safe:duration-[var(--duration-instant),150ms] motion-safe:ease-[var(--ease-out)] motion-safe:enabled:active:scale-[0.98]`;
export const selectionThumbnailSize = "aspect-video w-[clamp(3.5rem,25cqw,6rem)] shrink-0";
export const selectionThumbnailClass = `${artworkStyles.surface} ${cardStyles.card} ${cardStyles.frame} ${selectionThumbnailSize} relative grid place-items-center overflow-hidden bg-muted`;
export const selectionTitleText = "text-[0.9375rem] leading-[1.4] font-medium";
export const selectionMetadataText = "mt-1 text-sm leading-snug text-muted-foreground";
