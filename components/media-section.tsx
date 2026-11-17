"use client";

import React, { useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CarouselAction } from "@/components/carousel-action";
import { MediaCard } from "@/components/media-card";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
import { warmCarouselArtwork } from "@/lib/media/carousel-artwork";
import styles from "./media-section.module.css";
import type { MediaItem } from "@/types/stremio";

interface MediaSectionProps {
  sectionName: string;
  mediaItems: MediaItem[];
  isLoading?: boolean;
  continueWatching?: boolean;
  revealArtwork?: boolean;
  cardSubtitles?: React.ReactNode[];
}

export function MediaSection({
  sectionName,
  mediaItems,
  isLoading = false,
  continueWatching = false,
  revealArtwork = true,
  cardSubtitles,
}: MediaSectionProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const hasItems = mediaItems.length > 0;

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
    <section aria-label={sectionName} className="relative z-10 mb-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="min-w-0 text-xl sm:text-2xl font-semibold text-foreground font-poppins">
          {sectionName}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <CarouselAction
            size="icon-sm"
            className="hidden md:inline-flex"
            aria-label={`Scroll ${sectionName} left`}
            onClick={scrollLeft}
          >
            <ChevronLeft aria-hidden="true" />
          </CarouselAction>
          <CarouselAction
            size="icon-sm"
            className="hidden md:inline-flex"
            aria-label={`Scroll ${sectionName} right`}
            onClick={scrollRight}
          >
            <ChevronRight aria-hidden="true" />
          </CarouselAction>
        </div>
      </div>
      {hasItems ? (
        <div ref={viewportRef} data-media-row-viewport="" className={styles.viewport}
          role="region" aria-label={`${sectionName} titles`} tabIndex={-1}>
          <ul className={styles.track}>
            {mediaItems.map((item, index) => (
              <li
                key={continueWatching ? `${item.type}:${item.id}` : `${item.type}:${item.id}:${item.addonName ?? "unknown"}:${item.catalogName ?? "unknown"}:${index}`}
                data-continue-watching-index={continueWatching ? index : undefined}
                className="flex-shrink-0"
              >
                <MediaCard
                  item={item}
                  continueWatching={continueWatching}
                  revealArtwork={revealArtwork}
                  subtitleContent={cardSubtitles?.[index]}
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
