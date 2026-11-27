"use client";

import { ArtworkImage } from "@/components/artwork-image";
import { detailPosterUrl } from "@/lib/artwork";

import styles from "./detail-artwork.module.css";

import { useState } from "react";
import type { MediaItem } from "@/types/stremio";

interface PosterImageProps {
  name?: string;
  movie?: Pick<MediaItem, "name">;
  posterImage: string;
  className?: string;
  width?: number;
  height?: number;
}

export function PosterImage({
  name,
  movie,
  posterImage,
  className = "w-full h-auto rounded-lg",
  width = 500,
  height = 750,
}: PosterImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const mediaName = name ?? movie?.name ?? "Media";
  const resolvedPosterImage = detailPosterUrl(posterImage);

  if (!resolvedPosterImage || failedSrc === resolvedPosterImage) {
    return (
      <div
        role="img"
        aria-label={`${mediaName} poster unavailable`}
        className={`${styles.surface} ${styles.poster} ${className} flex items-center justify-center bg-muted text-sm text-muted-foreground`}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        Poster unavailable
      </div>
    );
  }

  return (
    <ArtworkImage
      draggable={false}
      className={`${styles.surface} ${styles.poster} ${className}`}
      src={resolvedPosterImage}
      alt={`${mediaName} poster`}
      width={width}
      height={height}
      decoding="async"
      onError={() => setFailedSrc(resolvedPosterImage)}
    />
  );
}
