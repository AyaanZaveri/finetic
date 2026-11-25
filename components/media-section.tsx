"use client";

import React, { useRef, useEffect, useLayoutEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CarouselAction } from "@/components/carousel-action";
import { MediaCard } from "@/components/media-card";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
import { observeCarouselControls } from "@/lib/media/carousel-controls";
import { warmCarouselArtwork } from "@/lib/media/carousel-artwork";
import { continueWatchingCardKey } from "@/lib/media/continue-watching-query";
import { createAddonRemovalMotion } from "./addon-removal-motion";
import styles from "./media-section.module.css";
import type { MediaItem } from "@/types/stremio";

interface MediaSectionProps {
  sectionName: string;
  mediaItems: MediaItem[];
  isLoading?: boolean;
  continueWatching?: boolean;
  revealArtwork?: boolean;
  cardSubtitles?: React.ReactNode[];
  mobileGrid?: boolean;
}

export function MediaSection({
  sectionName,
  mediaItems,
  isLoading = false,
  continueWatching = false,
  revealArtwork = true,
  cardSubtitles,
  mobileGrid = false,
}: MediaSectionProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [removalMotion] = useState(() => createAddonRemovalMotion(rows.current, {
    clipTo: () => viewportRef.current, deferAttachment: true,
  }));
  const removal = useRef<{ key: string; index: number; play?: () => void } | undefined>(undefined);
  const previousKeys = useRef("");
  const rowKeys = React.useMemo(() => continueWatching ? mediaItems.map(continueWatchingCardKey) : [], [continueWatching, mediaItems]);
  const rowIdentity = JSON.stringify(rowKeys);

  const prepareRemoval = (key: string, index: number, animate: boolean) => {
    const transaction = { key, index, play: undefined as (() => void) | undefined };
    removal.current = transaction;
    try { transaction.play = removalMotion.prepare(key, animate); }
    catch { removalMotion.cancel(); }
    return () => {
      if (removal.current === transaction) {
        removal.current = undefined;
        removalMotion.cancel();
      }
    };
  };

  useLayoutEffect(() => {
    if (!continueWatching) return;
    const pending = removal.current;
    if (pending && !rowKeys.includes(pending.key)) {
      removal.current = undefined;
      pending.play?.();
      // The old card is no longer a valid return-focus target. Do not steal
      // focus from an element the user has already moved to.
      if (document.activeElement === document.body || !document.activeElement?.isConnected) {
        const nextKey = rowKeys[Math.min(pending.index, rowKeys.length - 1)];
        const next = nextKey ? rows.current.get(nextKey)?.querySelector<HTMLElement>("a[href]") : null;
        (next ?? headingRef.current)?.focus({ preventScroll: true });
      }
    } else if (previousKeys.current !== rowIdentity) {
      removalMotion.cancel();
      if (pending) pending.play = undefined;
    }
    previousKeys.current = rowIdentity;
  }, [continueWatching, rowIdentity, rowKeys, removalMotion]);

  useEffect(() => {
    if (!continueWatching) return;
    const cancel = () => {
      removalMotion.cancel();
      if (removal.current) removal.current.play = undefined;
    };
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("resize", cancel);
    if (typeof document !== "undefined") document.addEventListener("scroll", cancel, true);
    preference.addEventListener?.("change", cancel);
    return () => {
      window.removeEventListener("resize", cancel);
      if (typeof document !== "undefined") document.removeEventListener("scroll", cancel, true);
      preference.removeEventListener?.("change", cancel);
      removal.current = undefined;
      removalMotion.cancel();
    };
  }, [continueWatching, removalMotion]);
  const hasItems = mediaItems.length > 0;
  const [position, setPosition] = useState({ overflow: false, start: true, end: true });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    return observeCarouselControls(viewport, next => setPosition(previous =>
      previous.overflow === next.overflow && previous.start === next.start && previous.end === next.end ? previous : next));
  }, [hasItems, mediaItems.length]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (continueWatching && viewport) return warmCarouselArtwork(viewport);
  }, [continueWatching, hasItems]);

  const scrollLeft = () => {
    if (viewportRef.current) {
      viewportRef.current.scrollBy({ left: -300, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
  };

  const scrollRight = () => {
    if (viewportRef.current) {
      viewportRef.current.scrollBy({ left: 300, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
  };

  return (
    <section data-mobile-grid={mobileGrid || undefined} aria-label={sectionName} className="relative z-10 mb-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 ref={headingRef} tabIndex={continueWatching ? -1 : undefined} className="min-w-0 text-xl sm:text-2xl font-semibold text-foreground font-poppins">
          {sectionName}
        </h2>
        {position.overflow && <div className="flex shrink-0 items-center gap-2">
          <CarouselAction
            size="icon-sm"
            className="hidden md:inline-flex"
            disabled={position.start}
            aria-label={`Scroll ${sectionName} left`}
            onClick={scrollLeft}
          >
            <ChevronLeft aria-hidden="true" />
          </CarouselAction>
          <CarouselAction
            size="icon-sm"
            className="hidden md:inline-flex"
            disabled={position.end}
            aria-label={`Scroll ${sectionName} right`}
            onClick={scrollRight}
          >
            <ChevronRight aria-hidden="true" />
          </CarouselAction>
        </div>}
      </div>
      {hasItems ? (
        <div ref={viewportRef} data-media-row-viewport="" className={styles.viewport}
          role="region" aria-label={`${sectionName} titles`} tabIndex={-1}>
          <ul className={styles.track}>
            {mediaItems.map((item, index) => (
              <li
                key={continueWatching ? `${item.type}:${item.id}` : `${item.type}:${item.id}:${item.addonName ?? "unknown"}:${item.catalogName ?? "unknown"}:${index}`}
                data-continue-watching-index={continueWatching ? index : undefined}
                ref={continueWatching ? element => {
                  const key = rowKeys[index];
                  if (element) rows.current.set(key, element);
                  else rows.current.delete(key);
                } : undefined}
                className="flex-shrink-0"
              >
                <MediaCard
                  item={item}
                  continueWatching={continueWatching}
                  revealArtwork={revealArtwork}
                  subtitleContent={cardSubtitles?.[index]}
                  onRemovalIntent={continueWatching ? animate => prepareRemoval(rowKeys[index], index, animate) : undefined}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Card className="bg-card border-border text-foreground">
          <CardContent className="p-8 text-center">
            <Play className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
            <p className="text-muted-foreground">
              No {sectionName.toLowerCase()} found in your library
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
