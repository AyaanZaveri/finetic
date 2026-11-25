"use client";

import { useCallback, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./artwork-image.module.css";

type Props = Omit<ComponentPropsWithoutRef<"img">, "src"> & {
  src?: string;
  fallbackText?: string;
  /** "late" reveals newly loaded pixels without replaying already-complete images. */
  reveal?: boolean | "late";
  onUnavailable?: () => void;
};

export function ArtworkPlaceholder({ label = "Artwork unavailable", className, ...props }: ComponentPropsWithoutRef<"span"> & { label?: string }) {
  return <span role="img" aria-label={label || undefined} {...props}
    data-compact={!label || undefined} className={cn(className, styles.fallback)}>
    <Film aria-hidden="true" className={styles.fallbackIcon} strokeWidth={1.5} />
    {label && <span aria-hidden="true" className={styles.fallbackLabel}>{label}</span>}
  </span>;
}

/** Keep native image geometry; reveal loaded pixels over the card's surface. */
export function ArtworkImage({
  src, srcSet, sizes, alt = "", className, style, width, height,
  onLoad, onError, onUnavailable, decoding = "async", fallbackText = "Artwork unavailable", reveal = true, ...props
}: Props) {
  const key = JSON.stringify([src, srcSet, sizes]);
  const [result, setResult] = useState<{ key: string; state: "ready" | "error"; unseen?: boolean; late?: boolean } | null>(null);
  const pendingKey = useRef<string | null>(null);
  const state = !src ? "error" : result?.key === key ? result.state : "loading";

  const finish = useCallback((image: HTMLImageElement, late: boolean) => {
    const box = image.getBoundingClientRect?.();
    const unseen = !!box && box.right > box.left && box.bottom > box.top && (box.bottom <= 0 || box.right <= 0 || box.top >= window.innerHeight || box.left >= window.innerWidth);
    // A load event can follow the cached-image ref callback, or a ref can
    // attach again after a real load. Preserve the first readiness decision.
    setResult(previous => previous?.key === key && previous.state === "ready" ? previous : { key, state: "ready", unseen, late });
  }, [key]);
  const fail = useCallback(() => {
    setResult({ key, state: "error" });
    onUnavailable?.();
  }, [key, onUnavailable]);

  const attach = useCallback((image: HTMLImageElement | null) => {
    // A cached image can finish before hydration attaches load/error handlers.
    if (!image || !src) return;
    if (image.complete) {
      if (image.naturalWidth > 0) finish(image, pendingKey.current === key);
      else fail();
    } else pendingKey.current = key;
  }, [src, key, finish, fail]);

  if (state === "error") {
    return <ArtworkPlaceholder label={fallbackText} aria-label={alt ? `${alt}: ${fallbackText}` : fallbackText}
      aria-hidden={props["aria-hidden"] ?? (alt ? undefined : true)}
      data-artwork-state="error"
      className={className}
      style={{ aspectRatio: width && height ? `${width} / ${height}` : undefined, ...style }} />;
  }

  const revealing = state === "ready" && !result?.unseen && (reveal === true || (reveal === "late" && result?.late));
  return <img {...props} ref={attach} src={src} srcSet={srcSet} sizes={sizes}
    alt={alt} width={width} height={height} style={style} decoding={decoding}
    data-artwork-state={state}
    data-artwork-revealing={revealing ? "" : undefined}
    className={cn(className, styles.image, state === "loading" && styles.pending,
      revealing && styles.reveal)}
    onLoad={event => {
      finish(event.currentTarget, true);
      onLoad?.(event);
    }}
    onError={event => {
      fail();
      onError?.(event);
    }} />;
}
