"use client";

import { useState, type ReactEventHandler } from "react";

interface VibrantLogoProps {
  src: string;
  alt: string;
  movieName: string;
  className?: string;
  width?: number;
  height?: number;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  onError?: () => void;
}

export function VibrantLogo({
  src,
  alt,
  className = "max-h-20 md:max-h-24 w-auto object-contain",
  width = 300,
  height = 96,
  onLoad,
  onError,
}: VibrantLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return null;

  return (
    <img
      draggable={false}
      loading="eager"
      className={className}
      src={src}
      alt={alt}
      width={width}
      height={height}
      onLoad={onLoad}
      onError={() => {
        setFailedSrc(src);
        onError?.();
      }}
    />
  );
}
