"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./segmented-control.module.css";

export interface Segment { value: string; label: string; /** Optional content after the label, such as a badge. */ accessory?: ReactNode; }
export interface SegmentedControlProps {
  options: Segment[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  /** Called when the pointer or focus reaches an option, before it is chosen. Use it to start loading what that option shows. */
  onOptionIntent?: (value: string) => void;
  className?: string;
}

export default function SegmentedControl({ options, value, onValueChange, label, onOptionIntent, className }: SegmentedControlProps) {
  const id = useId();
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ x: number; width: number } | null>(null);

  // Local offsets never include the page scroll position. Shared layout projection
  // can otherwise carry the scroll delta into the highlight's vertical animation.
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = () => {
      const button = node.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!button) return;
      const next = { x: button.offsetLeft, width: button.offsetWidth };
      setSelection(previous => previous?.x === next.x && previous.width === next.width ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    node.querySelectorAll("button").forEach(button => observer?.observe(button));
    return () => observer?.disconnect();
  }, [value, options.length]);

  // When the options are wider than the container, the track scrolls inside itself. Edges fade only on the side with more to see.
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const edges = () => {
      const rest = node.scrollWidth - node.clientWidth - node.scrollLeft;
      node.toggleAttribute("data-fade-start", node.scrollLeft > 1);
      node.toggleAttribute("data-fade-end", rest > 1);
    };
    edges();
    node.addEventListener("scroll", edges, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(edges);
    observer?.observe(node);
    return () => { node.removeEventListener("scroll", edges); observer?.disconnect(); };
  }, [options.length]);

  // The selected option is always scrolled fully into view, with a little room so it clears the fade.
  const first = useRef(true);
  useEffect(() => {
    const node = track.current;
    const button = node?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!node || !button || node.scrollWidth <= node.clientWidth) { first.current = false; return; }
    const room = 20, start = button.offsetLeft - room, end = button.offsetLeft + button.offsetWidth + room - node.clientWidth;
    const left = node.scrollLeft > start ? start : node.scrollLeft < end ? end : node.scrollLeft;
    if (left !== node.scrollLeft) node.scrollTo({ left: Math.max(0, left), behavior: first.current || reduced ? "auto" : "smooth" });
    first.current = false;
  }, [value, reduced]);

  // This group is horizontal. Leave Up/Down to parent menus and page scrolling.
  // Left/Right, Home and End select an option; only that option is a tab stop.
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const target = event.key === "ArrowRight" ? (selectedIndex === last ? 0 : selectedIndex + 1)
      : event.key === "ArrowLeft" ? (selectedIndex === 0 ? last : selectedIndex - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target < 0 || !options[target]) return;
    event.preventDefault();
    onValueChange(options[target].value);
    track.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(options[target].value)}"]`)?.focus({ preventScroll: true });
  };

  return <div className={`${styles.root} ${className ?? ""}`} role="group" aria-label={label}>
    <div ref={track} className={styles.track}>
      {selection && <motion.span className={styles.selection} initial={false}
        animate={{ x: selection.x, width: selection.width }}
        transition={reduced ? { duration: 0 } : motionTokens.spring.snappy} aria-hidden="true" />}
      {options.map((option, index) => <button key={option.value} id={`${id}-${option.value}`} className={styles.button} type="button" data-value={option.value} aria-pressed={value === option.value} tabIndex={index === selectedIndex ? 0 : -1} onClick={() => onValueChange(option.value)} onKeyDown={onKeyDown} onPointerEnter={onOptionIntent ? () => onOptionIntent(option.value) : undefined} onFocus={onOptionIntent ? () => onOptionIntent(option.value) : undefined} draggable={false}>
        <span className={styles.label}><span data-segment-label>{option.label}</span>{option.accessory}</span>
      </button>)}
    </div>
  </div>;
}
