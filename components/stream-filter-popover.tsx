"use client";

import { Check, RotateCcw, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { Button } from "@/components/ui/button";
import { streamFilterGroups } from "@/lib/media/stream-filter-options";
import { motionTokens } from "@/components/arc/motion-tokens";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import styles from "./stream-filter-popover.module.css";

const formatLogos: Record<string, string> = {
  "dolby-vision": "dolby-vision",
  atmos: "dolby-atmos",
  truehd: "dolby-truehd",
  bluray: "bluray",
  dvd: "dvd",
  hdr10plus: "hdr10plus",
  "dts-x": "dts-x",
};

function FormatLabel({ tag, label }: { tag: string; label: string }) {
  const logo = formatLogos[tag];
  if (logo) {
    return <span aria-hidden="true" className={styles.formatLogo} data-format-logo={logo} />;
  }
  if (tag === "av1") {
    return <span aria-hidden="true" className={styles.av1Logo}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.av1Black} src="/logo/formats/av1-black.svg" alt="" width="32" height="18" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.av1White} src="/logo/formats/av1-white.svg" alt="" width="32" height="18" />
    </span>;
  }
  return label;
}

export function StreamFilterPopover({ value, onChange, container }: {
  value: string[];
  onChange(_value: string[]): void;
  container?: HTMLElement | null;
}) {
  const reducedMotion = useReducedMotion();
  const toggle = (tag: string) => onChange(value.includes(tag) ? value.filter(item => item !== tag) : [...value, tag]);
  const countTransition: Transition = { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.out] };
  const checkTransition: Transition = { duration: reducedMotion ? 0 : motionTokens.duration.standard, ease: [...motionTokens.ease.out] };
  const countEnter = reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(3px)" };
  const countExit = reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-3px)" };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={styles.trigger} aria-label={value.length ? `Filters, ${value.length} selected` : "Filters"}>
          <SlidersHorizontal aria-hidden="true" className="text-muted-foreground" />
          <span>Filters</span>
          <AnimatePresence initial={false}>
            {value.length > 0 && <motion.span className={styles.count} aria-hidden="true"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "scale(0.95)" }}
              animate={{ opacity: 1, transform: "scale(1)" }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "scale(0.95)" }}
              transition={countTransition}>
              <AnimatePresence initial={false}>
                <motion.span key={value.length} className={styles.countDigit}
                  initial={countEnter} animate={{ opacity: 1, transform: "translateY(0)" }}
                  exit={countExit} transition={countTransition}>{value.length}</motion.span>
              </AnimatePresence>
            </motion.span>}
          </AnimatePresence>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        collisionBoundary={container ?? undefined}
        align="end"
        sideOffset={6}
        data-base-ui-swipe-ignore=""
        aria-label="Stream filters"
        className={`${floatingSurface.surface} ${styles.panel}`}>
        <header className={styles.header}>
          <span className="font-semibold text-sm">Filters</span>
          <Button type="button" variant="ghost" size="icon-sm" className={styles.reset}
            aria-label="Clear filters" title="Clear filters" disabled={!value.length} onClick={() => onChange([])}>
            <RotateCcw aria-hidden="true" />
          </Button>
        </header>
        <div className={styles.groups}>
          {streamFilterGroups.map(group => (
            <fieldset className={styles.group} key={group.label}>
              <legend>{group.label}</legend>
              <div className={styles.options}>
                {group.options.map(option => {
                  const selected = value.includes(option.value);
                  return <Button type="button" key={option.value} variant={selected ? "default" : "outline"}
                    size="sm" aria-pressed={selected} aria-label={option.label}
                    title={option.label}
                    className={styles.option} onClick={() => toggle(option.value)}>
                    <motion.span className={styles.checkSlot} aria-hidden="true" initial={false}
                      animate={{ width: selected ? 22 : 0 }} transition={checkTransition}>
                      <motion.span className={styles.checkIcon} initial={false}
                        animate={{
                          opacity: selected ? 1 : 0,
                          transform: selected || reducedMotion ? "translateX(0px)" : "translateX(-4px)",
                        }} transition={{ ...checkTransition, duration: reducedMotion ? 0 : motionTokens.duration.exit }}>
                        <Check strokeWidth={2} />
                      </motion.span>
                    </motion.span>
                    <FormatLabel tag={option.value} label={option.label} />
                  </Button>;
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <footer className={styles.footer}>
          <PopoverClose asChild>
            <Button type="button" size="sm">Done</Button>
          </PopoverClose>
        </footer>
      </PopoverContent>
    </Popover>
  );
}
