"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref, RefObject } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import type {
  AnimationPlaybackControls,
  HTMLMotionProps,
  MotionValue,
  TargetAndTransition,
  Transition,
} from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./chip-group.module.css";

export interface ChipOption {
  value: string;
  label: string;
}

/**
 * Selectable filter chips for narrowing a list by facets people toggle often, such as topics, statuses, or tags.
 * Selecting morphs the chip: a check grows in, the label slides over, and the chip's edge follows on a spring while its
 * neighbours glide to their new places, even across lines. Long sets fold behind a “+N more” chip that opens with a height morph.
 * Arrow keys move between chips, Space or Enter toggles, and each chip is a pressed or unpressed button.
 */
export interface ChipGroupProps {
  size?: "sm" | "md";
  options: ChipOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Accessible name of the group, such as “Topics”. */
  label: string;
  /** Allow several chips at once. In single mode the selected chip can still be cleared. */
  multiple?: boolean;
  /** Chips shown before the rest fold behind a “+N more” chip. Chips selected when it folds stay in view. */
  maxVisible?: number;
  className?: string;
}

/** Roving-focus key of the overflow chip; the NUL keeps it from colliding with any option value. */
const MORE = "\u0000more";
const standard = [...motionTokens.ease.standard] as [
  number,
  number,
  number,
  number,
];
const enterEase = [...motionTokens.ease.enter] as [
  number,
  number,
  number,
  number,
];
const fade: Transition = {
  duration: motionTokens.duration.fast,
  ease: standard,
};
const reducedFade: Transition = { duration: 0.15, ease: standard };
const exitFast: Transition = {
  duration: motionTokens.duration.fast,
  ease: standard,
};
const shown: TargetAndTransition = {
  opacity: 1,
  y: "0em",
  scale: 1,
  filter: "blur(0px)",
};
const textIn: TargetAndTransition = {
  opacity: 0,
  y: "0.3em",
  filter: `blur(${motionTokens.blur.soft}px)`,
};
const textOut: TargetAndTransition = {
  opacity: 0,
  y: "-0.3em",
  filter: `blur(${motionTokens.blur.subtle}px)`,
  transition: exitFast,
};

/**
 * A chip's layout width changes in one frame (so the row can re-flow once and neighbours can glide), but what you see must not.
 * `lag` is how far the visible edge trails the layout edge: it jumps by the change, then springs back to zero.
 * Passive resizes, like a late web font, only re-baseline it.
 */
function useWidthLag(
  node: RefObject<HTMLElement | null>,
  key: string,
  reduce: boolean,
) {
  const lag = useMotionValue(0);
  const width = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const next = element.offsetWidth,
      previous = width.current;
    width.current = next;
    if (previous === null || previous === next) return;
    if (reduce) {
      lag.jump(0);
      return;
    }
    // Retarget from wherever the edge is now and keep its speed, so fast toggling never snaps.
    const velocity = lag.getVelocity();
    lag.jump(lag.get() + previous - next);
    animate(lag, 0, { ...motionTokens.spring.morph, velocity });
  }, [key, lag, node, reduce]);
  useEffect(() => {
    const element = node.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      width.current = element.offsetWidth;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [node]);
  return lag;
}

/** Follows the chips' height. After `morphKey` changes (a selection, opening the overflow) it springs from the old height to the new one, then returns to auto. It clips only while moving, so nothing is cut off at rest. */
function HeightFrame({
  morphKey,
  reduce,
  children,
}: {
  morphKey: string;
  reduce: boolean;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | "auto">("auto");
  const changedAt = useRef(0);
  const last = useRef<number | undefined>(undefined);
  const animating = useRef(false);
  /* Pin the old height in the same commit as the change, before Motion measures the chips' new layout. Otherwise the chips
     are measured against an unpinned frame, the centred demo shifts by half the growth for that measurement, and the first row
     sinks and floats back while the height springs. */
  useLayoutEffect(() => {
    changedAt.current = performance.now();
    const node = frame.current;
    if (reduce || !node || last.current === undefined) return;
    const current = height.get();
    const from = typeof current === "number" ? current : last.current;
    height.jump(from);
    Object.assign(node.style, {
      overflow: "clip",
      height: `${from}px`,
      minHeight: `${from}px`,
    });
    // If the change leaves the height alone, no resize follows, so release the pin after a frame.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (animating.current) return;
        height.jump("auto");
        if (frame.current)
          Object.assign(frame.current.style, {
            overflow: "",
            height: "auto",
            minHeight: "",
          });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [morphKey, reduce, height]);
  useEffect(() => {
    const node = content.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let controls: AnimationPlaybackControls | undefined;
    const settle = () => {
      animating.current = false;
      height.jump("auto");
      if (frame.current)
        Object.assign(frame.current.style, {
          overflow: "",
          height: "auto",
          minHeight: "",
        });
    };
    // The minimum follows the moving height, so a flex parent short on room cannot squeeze the frame mid-morph and snap it when the morph ends.
    const unfollow = height.on("change", (value) => {
      if (frame.current)
        frame.current.style.minHeight =
          typeof value === "number" ? `${value}px` : "";
    });
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      const current = height.get();
      const from = typeof current === "number" ? current : last.current;
      last.current = next;
      controls?.stop();
      if (
        reduce ||
        from === undefined ||
        Math.abs(from - next) < 0.5 ||
        performance.now() - changedAt.current > 160
      )
        return settle();
      // Pin the old height before this frame paints, then spring to the new one.
      if (frame.current)
        Object.assign(frame.current.style, {
          overflow: "clip",
          height: `${from}px`,
          minHeight: `${from}px`,
        });
      animating.current = true;
      controls = animate(height, [from, next], {
        ...motionTokens.spring.smooth,
        onComplete: settle,
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      unfollow();
      controls?.stop();
    };
  }, [height, reduce]);
  return (
    <motion.div ref={frame} className={styles.frame} style={{ height }}>
      <div ref={content} className={styles.content}>
        {children}
      </div>
    </motion.div>
  );
}

/** Outgoing copies are hidden from assistive tech while they fade, so the button reads only its current text.
 *  `follow` is the centring offset of the current line; a leaving line holds the offset it had when it left, so the new line's centring never drags it sideways. */
function Swap({
  follow,
  style,
  ...props
}: HTMLMotionProps<"span"> & { follow?: MotionValue<number> }) {
  const present = useIsPresent();
  const held = useMotionValue(0);
  // Runs before the chip re-measures its width in the same commit, so this reads the offset from before the change.
  useLayoutEffect(() => {
    if (!present && follow) held.jump(follow.get());
  }, [present, follow, held]);
  return (
    <motion.span
      {...props}
      style={follow ? { ...style, x: present ? follow : held } : style}
      aria-hidden={present ? props["aria-hidden"] : true}
    />
  );
}

interface ChipProps {
  option: ChipOption;
  selected: boolean;
  tabbable: boolean;
  reduce: boolean;
  delay: number;
  onToggle: (value: string) => void;
  onFocusChip: (value: string) => void;
  ref?: Ref<HTMLButtonElement>;
}

/** The width the check takes from the label: a 14px glyph and the space after it. */
const SLOT = 18;

function Chip({
  option,
  selected,
  tabbable,
  reduce,
  delay,
  onToggle,
  onFocusChip,
  ref,
}: ChipProps) {
  const present = useIsPresent();
  const body = useRef<HTMLSpanElement>(null);
  const lag = useWidthLag(body, String(selected), reduce);
  /* How far the check has grown: the slot it was given, less the width the label still lags behind. It follows both inputs
     explicitly, so a jump with no animation (reduced motion) still lands the check in its final state. */
  const slot = useRef(selected ? SLOT : 0);
  const grown = useMotionValue(selected ? 1 : 0);
  const edge = useTransform(lag, (value) => -value);
  // The check grows from zero width in exactly the gap the label opens as it slides over, so the two never overlap, and deselecting runs it backwards.
  const checkScale = useTransform(grown, (value) => Math.min(value, 1.1));
  const checkOpacity = useTransform(grown, (value) => Math.min(1, value * 1.4));
  const checkBlur = useTransform(grown, (value) =>
    value >= 1
      ? "none"
      : `blur(${((1 - value) * motionTokens.blur.subtle).toFixed(2)}px)`,
  );
  /* The stroke draws in step with the growth, so the check writes itself as the label makes room. */
  const checkDraw = useTransform(grown, (value) =>
    Math.min(1, Math.max(0.001, value)),
  );
  // Declared after the transforms so they are already subscribed when a reduced-motion selection jumps straight to the end.
  useLayoutEffect(() => {
    slot.current = selected ? SLOT : 0;
    const update = () =>
      grown.set(Math.max(0, (slot.current + lag.get()) / SLOT));
    update();
    return lag.on("change", update);
  }, [selected, lag, grown]);
  // Revealed chips grow in with a short stagger; chips that fold away leave faster than they came.
  const enter: Transition = reduce
    ? { layout: { duration: 0 }, default: reducedFade }
    : {
        layout: motionTokens.spring.morph,
        default: { ...motionTokens.spring.snappy, delay },
        opacity: { ...fade, delay },
      };
  return (
    <motion.button
      ref={ref}
      type="button"
      className={styles.chip}
      data-chip={option.value}
      aria-pressed={selected}
      aria-hidden={present ? undefined : true}
      tabIndex={present && tabbable ? 0 : -1}
      onClick={() => onToggle(option.value)}
      onFocus={() => onFocusChip(option.value)}
      layout="position"
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={
        reduce
          ? { opacity: 0, transition: reducedFade }
          : {
              opacity: 0,
              scale: 0.9,
              transition: {
                duration: motionTokens.duration.instant,
                ease: standard,
              },
            }
      }
      transition={enter} draggable={false}
    >
      <span ref={body} className={styles.body} data-selected={selected}>
        <motion.span
          className={styles.surface}
          style={{ right: edge }}
          aria-hidden="true"
        />
        <motion.span
          className={styles.check}
          style={{
            scale: checkScale,
            opacity: checkOpacity,
            filter: checkBlur,
          }}
          aria-hidden="true"
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <motion.path
              d="M4 12.5 9.5 18 20 6.5"
              style={{ pathLength: checkDraw }}
            />
          </svg>
        </motion.span>
        <span className={styles.slot} aria-hidden="true" />
        <motion.span className={styles.label} style={{ x: lag }}>
          {option.label}
        </motion.span>
      </span>
    </motion.button>
  );
}

interface MoreChipProps {
  hidden: number;
  expanded: boolean;
  tabbable: boolean;
  reduce: boolean;
  onToggle: () => void;
  onFocusChip: (value: string) => void;
  ref?: Ref<HTMLButtonElement>;
}

function MoreChip({
  hidden,
  expanded,
  tabbable,
  reduce,
  onToggle,
  onFocusChip,
  ref,
}: MoreChipProps) {
  const body = useRef<HTMLSpanElement>(null);
  const text = expanded ? "Show less" : `+${hidden} more`;
  const lag = useWidthLag(body, text, reduce);
  const edge = useTransform(lag, (value) => -value);
  // The text stays centred on the visible surface while its edge catches up.
  const centre = useTransform(lag, (value) => value / 2);
  return (
    <motion.button
      ref={ref}
      type="button"
      className={`${styles.chip} ${styles.more}`}
      data-more=""
      aria-expanded={expanded}
      tabIndex={tabbable ? 0 : -1}
      onClick={onToggle}
      onFocus={() => onFocusChip(MORE)}
      layout="position"
      transition={{
        layout: reduce ? { duration: 0 } : motionTokens.spring.morph,
      }} draggable={false}
    >
      <span ref={body} className={styles.body}>
        <motion.span
          className={styles.surface}
          style={{ right: edge }}
          aria-hidden="true"
        />
        <span className={styles.moreText}>
          <AnimatePresence mode="popLayout" initial={false}>
            <Swap
              key={text}
              follow={centre}
              className={styles.moreLine}
              initial={reduce ? { opacity: 0 } : textIn}
              animate={shown}
              exit={reduce ? { opacity: 0, transition: reducedFade } : textOut}
              transition={
                reduce
                  ? reducedFade
                  : {
                      duration: motionTokens.duration.standard,
                      ease: enterEase,
                    }
              }
            >
              {text}
            </Swap>
          </AnimatePresence>
        </span>
      </span>
    </motion.button>
  );
}

export function ChipGroup({
  options,
  value,
  onValueChange,
  label,
  multiple = true,
  maxVisible = Infinity,
  size = "md",
  className,
}: ChipGroupProps) {
  const id = useId();
  const reduce = !!useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  // Chips selected when the overflow folds stay in view, so a selection is never hidden and deselecting never makes a chip vanish.
  const [pinned, setPinned] = useState<string[]>(value);
  const [active, setActive] = useState<string | null>(null);
  const foldable = options.length > maxVisible;
  const visible =
    !foldable || expanded
      ? options
      : options.filter(
          (option, index) =>
            index < maxVisible ||
            pinned.includes(option.value) ||
            value.includes(option.value),
        );
  const hidden = options.length - visible.length;
  const showMore = foldable && (expanded || hidden > 0);
  const keys = [
    ...visible.map((option) => option.value),
    ...(showMore ? [MORE] : []),
  ];
  // One chip holds the tab stop: the last one focused, else the first selected, else the first.
  const tabStop =
    active !== null && keys.includes(active)
      ? active
      : (visible.find((option) => value.includes(option.value))?.value ??
        keys[0]);

  function toggle(next: string) {
    const on = value.includes(next);
    if (!multiple) return onValueChange(on ? [] : [next]);
    onValueChange(
      options
        .filter((option) =>
          option.value === next ? !on : value.includes(option.value),
        )
        .map((option) => option.value),
    );
  }

  function toggleMore() {
    if (expanded) setPinned(value);
    setExpanded(!expanded);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ":is(button[data-chip], button[data-more]):not([aria-hidden='true'])",
      ),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const last = buttons.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    buttons[moves[event.key]!]!.focus();
  }

  return (
    <LayoutGroup id={id}>
      <HeightFrame morphKey={`${expanded}|${value.join(",")}`} reduce={reduce}>
        <div
          className={[styles.group, className].filter(Boolean).join(" ")}
          data-size={size}
          role="group"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {/* Chips revealed by the overflow grow in one after another, in reading order. */}
            {visible.map((option, index) => (
              <Chip
                key={option.value}
                option={option}
                selected={value.includes(option.value)}
                tabbable={tabStop === option.value}
                reduce={reduce}
                delay={
                  expanded
                    ? Math.min(
                        Math.max(0, index - maxVisible) *
                          motionTokens.stagger.item,
                        0.3,
                      )
                    : 0
                }
                onToggle={toggle}
                onFocusChip={setActive}
              />
            ))}
            {showMore ? (
              <MoreChip
                key={MORE}
                hidden={hidden}
                expanded={expanded}
                tabbable={tabStop === MORE}
                reduce={reduce}
                onToggle={toggleMore}
                onFocusChip={setActive}
              />
            ) : null}
          </AnimatePresence>
        </div>
      </HeightFrame>
    </LayoutGroup>
  );
}

export default ChipGroup;
