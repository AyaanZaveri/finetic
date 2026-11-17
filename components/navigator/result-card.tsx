"use client";

import { ArtworkImage } from "@/components/artwork-image";

import { useContext, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { IntentLink } from "@/components/intent-link";
import { useSetAtom } from "jotai";
import { isAIAskOpenAtom } from "@/lib/atoms";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRuntime } from "@/lib/format-runtime";
import styles from "./result-card.module.css";
import { ResultCardEntranceContext } from "./result-card-motion";

export function ResultBadge({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className="h-5 max-w-full px-1.5 py-0 text-xs font-medium [&_svg]:size-3"
    >
      {children}
    </Badge>
  );
}

export function ResultMeta({ children }: { children: ReactNode }) {
  return <span className={styles.meta}>{children}</span>;
}

export function ResultCard({
  title,
  subtitle,
  icon: Icon,
  iconContent,
  image,
  imageAspect = "portrait",
  metadata,
  description,
  error,
  children,
  href,
  external = false,
  onClick,
  className,
  index = 0,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  iconContent?: ReactNode;
  image?: string | null;
  imageAspect?: "portrait" | "landscape";
  metadata?: ReactNode;
  description?: ReactNode;
  error?: string;
  children?: ReactNode;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  className?: string;
  index?: number;
}) {
  const reduceMotion = useReducedMotion();
  const animateEntrance = useContext(ResultCardEntranceContext);
  const closeNavigator = useSetAtom(isAIAskOpenAtom);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const interactive = !!(href || onClick);
  const Copy = onClick && !href ? "span" : "div";
  const Body = onClick && !href ? "span" : "div";
  const hasLeading = (image && image !== failedImage) || Icon || iconContent;
  const rowClass = cn(styles.row, !hasLeading && styles.textOnly, imageAspect === "landscape" && styles.landscape, interactive && styles.interactive, className);
  const content = (
    <>
      {image && image !== failedImage ? (
        <ArtworkImage
          draggable={false}
          src={image}
          alt=""
          aria-hidden="true"
          className={styles.image}
          data-aspect={imageAspect}
          onError={() => setFailedImage(image)}
        />
      ) : iconContent ? (
        <span className={styles.leading} aria-hidden="true">{iconContent}</span>
      ) : Icon ? (
        <span className={styles.icon} aria-hidden="true"><Icon className="size-4" /></span>
      ) : null}
      <Copy className={styles.copy}>
        {title != null && <span className={styles.title}>
          <span className={styles.titleText}>{title}</span>
          {interactive && (
            <ArrowRight aria-hidden="true" className={styles.arrow} />
          )}
        </span>}
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        {metadata && <span className={styles.metadata}>{metadata}</span>}
        {description && (
          <span className={styles.description}>{description}</span>
        )}
        {error && (
          <span role="alert" className={styles.error}>
            {error}
          </span>
        )}
        {children && <Body className={styles.body}>{children}</Body>}
      </Copy>
    </>
  );
  const activate = () => {
    onClick?.();
    closeNavigator(false);
  };
  return (
    <motion.div
      animate={{ opacity: 1, transform: reduceMotion ? "none" : "translateY(0)" }}
      initial={animateEntrance ? {
        opacity: 0,
        transform: reduceMotion ? "none" : "translateY(10px)",
      } : false}
      transition={{
        delay: reduceMotion ? 0 : Math.min(index * 0.05, 0.15),
        duration: 0.18,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      {href && external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={rowClass}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        >
          {content}
        </a>
      ) : href ? (
        <IntentLink
          href={href}
          className={rowClass}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          onClick={activate}
        >
          {content}
        </IntentLink>
      ) : onClick ? (
        <button type="button" className={rowClass} onClick={activate} draggable={false}>
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </motion.div>
  );
}

export function formatCardRuntime(minutes?: number) {
  if (!minutes) return null;
  return formatRuntime(minutes);
}
