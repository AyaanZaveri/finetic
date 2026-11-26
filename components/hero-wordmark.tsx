"use client";

import { useCallback, useRef, useState } from "react";
import { getWordmarkBounds, getWordmarkDensity } from "@/lib/wordmark-bounds";
import { publicArtworkUrl } from "@/lib/artwork";
import { cn } from "@/lib/utils";
import styles from "./hero-wordmark.module.css";

const fullBounds = { left: 0, top: 0, width: 1, height: 1 };

function measureWordmark(image: HTMLImageElement, canSample: boolean) {
  const { naturalWidth, naturalHeight } = image;
  const intrinsic = { bounds: fullBounds, aspect: naturalWidth / naturalHeight, dense: false };
  if (!canSample) return intrinsic;

  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 160 / Math.max(naturalWidth, naturalHeight));
  canvas.width = Math.max(1, Math.round(naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return intrinsic;

  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const bounds = getWordmarkBounds(pixels, canvas.width, canvas.height);
    if (!bounds) return intrinsic;
    return {
      bounds,
      dense: getWordmarkDensity(pixels, canvas.width, canvas.height, bounds) > .5,
      aspect: (naturalWidth * bounds.width) / (naturalHeight * bounds.height),
    };
  } catch {
    // Intrinsic dimensions are available even when the browser restricts pixel access.
    return intrinsic;
  }
}

export function HeroWordmark({ src, alt, className, fetchPriority, onError }: {
  src: string;
  alt: string;
  className?: string;
  fetchPriority?: "high" | "low" | "auto";
  onError?: () => void;
}) {
  const [analysis, setAnalysis] = useState<({ src: string } & ReturnType<typeof measureWordmark>) | null>(null);
  const [corsFailedSrc, setCorsFailedSrc] = useState<string | null>(null);
  const displayedImage = useRef<HTMLImageElement | null>(null);
  const settledImage = useRef<HTMLImageElement | null>(null);
  const cors = Boolean(publicArtworkUrl(src)) && corsFailedSrc !== src;

  const imageLoaded = useCallback((image: HTMLImageElement) => {
    if (image !== displayedImage.current || image === settledImage.current || !image.naturalWidth || !image.naturalHeight) return;
    settledImage.current = image;
    setAnalysis({ src, ...measureWordmark(image, corsFailedSrc !== src) });
  }, [src, corsFailedSrc]);

  const imageFailed = useCallback((image: HTMLImageElement) => {
    if (image !== displayedImage.current || image === settledImage.current) return;
    settledImage.current = image;
    if (cors) setCorsFailedSrc(src);
    else onError?.();
  }, [cors, src, onError]);

  const attachImage = useCallback((image: HTMLImageElement | null) => {
    displayedImage.current = image;
    // Catch images that loaded or failed before React hydrated the markup.
    if (!image?.complete) return;
    if (image.naturalWidth) imageLoaded(image);
    else imageFailed(image);
  }, [imageLoaded, imageFailed]);

  const current = analysis?.src === src ? analysis : null;
  const bounds = current?.bounds ?? fullBounds;
  const aspect = current?.aspect ?? 800 / 310;
  return (
    <div
      className={cn(styles.root, className)}
      data-wide={aspect >= 3 || undefined}
      data-dense={current?.dense || undefined}
      data-ready={Boolean(current) || undefined}
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
          <img
            key={`${src}:${cors}`}
            ref={attachImage}
            crossOrigin={cors ? "anonymous" : undefined}
            loading="eager"
            fetchPriority={fetchPriority}
            src={src}
            alt={alt}
            draggable={false}
            width={800}
            height={310}
            className="block size-full max-w-none object-contain"
            onLoad={event => imageLoaded(event.currentTarget)}
            onError={event => imageFailed(event.currentTarget)}
          />
        </div>
      </div>
    </div>
  );
}
