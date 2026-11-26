"use client";

import { useEffect, useState } from "react";
import { VibrantLogo } from "./vibrant-logo";
import { getWordmarkBounds, getWordmarkDensity, type WordmarkBounds } from "@/lib/wordmark-bounds";
import { artworkSampleUrl } from "@/lib/artwork";
import { cn } from "@/lib/utils";
import styles from "./hero-wordmark.module.css";

export function HeroWordmark({
  src,
  alt,
  movieName,
  className,
  onError,
}: {
  src: string;
  alt: string;
  movieName: string;
  className?: string;
  onError?: () => void;
}) {
  const logoSrc = artworkSampleUrl(src);
  const [analysis, setAnalysis] = useState<{
    src: string;
    bounds: WordmarkBounds;
    aspect: number;
    dense?: boolean;
    ready?: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled || !image.naturalWidth || !image.naturalHeight) return;
      const measured = {
        src,
        bounds: { left: 0, top: 0, width: 1, height: 1 },
        aspect: image.naturalWidth / image.naturalHeight,
        ready: true,
      };
      const canvas = document.createElement("canvas");
      const scale = Math.min(
        1,
        160 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setAnalysis(measured);
        return;
      }
      try {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const bounds = getWordmarkBounds(
          pixels,
          canvas.width,
          canvas.height,
        );
        if (bounds) {
          setAnalysis({
            src,
            bounds,
            dense: getWordmarkDensity(pixels, canvas.width, canvas.height, bounds) > .5,
            ready: true,
            aspect:
              (image.naturalWidth * bounds.width) /
              (image.naturalHeight * bounds.height),
          });
          return;
        }
      } catch {
        /* Keep the original artwork if its pixels cannot be inspected. */
      }
      setAnalysis(measured);
    };
    image.onerror = () => {
      if (cancelled || !image.crossOrigin) return;
      image.crossOrigin = null;
      image.src = src;
    };
    image.src = logoSrc;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, logoSrc]);
  const current = analysis?.src === src ? analysis : null;
  const bounds = current?.bounds ?? { left: 0, top: 0, width: 1, height: 1 };
  const aspect = current?.aspect ?? 800 / 310;
  return (
    <div
      className={cn(styles.root, className)}
      data-wide={aspect >= 3 || undefined}
      data-dense={current?.dense || undefined}
      data-ready={current?.ready || undefined}
    >
      <div
        className={styles.artwork}
        style={{
          width: `min(100%, calc(var(--wordmark-max-height) * ${aspect}))`,
          aspectRatio: aspect,
        }}
      >
        <div
          className={styles.image}
          style={{
            left: `${(-bounds.left / bounds.width) * 100}%`,
            top: `${(-bounds.top / bounds.height) * 100}%`,
            width: `${100 / bounds.width}%`,
            height: `${100 / bounds.height}%`,
          }}
        >
          <VibrantLogo
            src={src}
            alt={alt}
            movieName={movieName}
            width={800}
            height={310}
            className="block size-full max-w-none object-contain"
            onError={onError}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (!naturalWidth || !naturalHeight) return;
              // Image dimensions remain available when CORS prevents pixel analysis.
              // Keep any tighter visible bounds that have already been measured.
              setAnalysis((previous) => previous?.src === src ? previous : {
                src,
                bounds: { left: 0, top: 0, width: 1, height: 1 },
                aspect: naturalWidth / naturalHeight,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}
