"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Ear, Eye, Minus, Plus } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/arc/popover/popover";
import { RulerSlider } from "@/components/arc/ruler-slider/ruler-slider";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { normalizeSubtitleDelay, subtitleDelayForMarks, SUBTITLE_TIMING_LIMIT } from "@/lib/media/subtitle-timing";
import glass from "./arc/floating-surface.module.css";
import styles from "./subtitle-timing-popover.module.css";

const syncMarks = [
  { kind: "heard", label: "Heard", key: "H", Icon: Ear },
  { kind: "saw", label: "Saw", key: "S", Icon: Eye },
] as const;

type Mark = { kind: (typeof syncMarks)[number]["kind"]; time: number };

export function SubtitleTimingPopover({ open, onOpenChange, seconds, onChange, available, container, mediaRef, sourceKey }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  seconds: number;
  onChange(seconds: number): void;
  available: boolean;
  container?: HTMLElement | null;
  mediaRef?: RefObject<HTMLVideoElement | null>;
  sourceKey?: string;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const interactedOutside = useRef(false);
  const [firstMark, setFirstMark] = useState<Mark | null>(null);
  const [syncStatus, setSyncStatus] = useState("");
  useEffect(() => {
    const clear = () => {
      setFirstMark(null);
      setSyncStatus("");
    };
    clear();
    if (!open || !available) return;
    const media = mediaRef?.current;
    const events = ["seeking", "emptied", "trackschange"];
    events.forEach(event => media?.addEventListener(event, clear));
    media?.textTracks?.addEventListener("change", clear);
    return () => {
      events.forEach(event => media?.removeEventListener(event, clear));
      media?.textTracks?.removeEventListener("change", clear);
    };
  }, [open, available, mediaRef, sourceKey]);
  const changeManually = (value: number) => {
    setFirstMark(null);
    setSyncStatus("");
    onChange(value);
  };
  const mark = (kind: Mark["kind"]) => {
    const media = mediaRef?.current;
    if (!open || !available || !media) return;
    if (media.paused || media.ended) {
      setSyncStatus("Play the video to mark a line.");
      return;
    }
    const time = media.currentTime;
    if (media.seeking || !Number.isFinite(time)) return;
    if (!firstMark || firstMark.kind === kind) {
      setFirstMark({ kind, time });
      setSyncStatus(kind === "heard" ? "Now mark when the same subtitle appears." : "Now mark when you hear the same line.");
      return;
    }
    const heard = kind === "heard" ? time : firstMark.time;
    const saw = kind === "saw" ? time : firstMark.time;
    const next = subtitleDelayForMarks(seconds, heard, saw);
    setFirstMark(null);
    if (next === null) {
      setSyncStatus("That offset is outside the timing range. Try another line.");
      return;
    }
    onChange(next);
    setSyncStatus("Timing updated. Mark another line to refine it.");
  };
  const trigger = container?.querySelector<HTMLElement>('[data-slot="media-player-subtitles"]');
  const description = !available ? "Timing unavailable for this subtitle track."
    : seconds === 0 ? "Original timing"
      : `Subtitles appear ${Math.abs(seconds).toFixed(1)} seconds ${seconds < 0 ? "earlier" : "later"}.`;
  const nudge = (direction: -1 | 1) => <Button type="button" variant="ghost" size="icon"
    className="size-11" aria-label={`Show subtitles 0.1 seconds ${direction < 0 ? "earlier" : "later"}`}
    title={direction < 0 ? "Earlier by 0.1 seconds" : "Later by 0.1 seconds"}
    disabled={!available || (direction < 0 ? seconds <= -SUBTITLE_TIMING_LIMIT : seconds >= SUBTITLE_TIMING_LIMIT)}
    onClick={() => changeManually(normalizeSubtitleDelay(seconds + direction * 0.1))}>
    {direction < 0 ? <Minus className="size-4" /> : <Plus className="size-4" />}
  </Button>;
  return <Popover open={open} onOpenChange={onOpenChange} modal={false}>
    <PopoverAnchor className={styles.anchor} aria-hidden="true" />
    <PopoverContent container={container} side="bottom" align="end" sideOffset={0} avoidCollisions={false}
      data-subtitle-timing="" data-player-native-glass="" className={`${glass.surface} ${styles.panel}`}
      aria-labelledby={headingId} aria-describedby={descriptionId}
      onKeyDown={event => {
        if (!open || !mediaRef || !available || event.defaultPrevented || event.nativeEvent.isComposing
          || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const action = syncMarks.find(item => item.key.toLowerCase() === event.key.toLowerCase());
        if (!action) return;
        event.preventDefault();
        if (!event.repeat) mark(action.kind);
      }}
      onOpenAutoFocus={event => {
        const panel = event.currentTarget as HTMLElement;
        const target = panel.querySelector<HTMLElement>('[role="slider"]:not([aria-disabled="true"])')
          ?? panel.querySelector<HTMLElement>('[data-timing-done]');
        if (target) { event.preventDefault(); target.focus(); }
      }}
      onInteractOutside={() => {
        interactedOutside.current = true;
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (!interactedOutside.current && trigger?.isConnected) trigger.focus({ preventScroll: true });
        interactedOutside.current = false;
      }}>
      <div className={styles.header}>
        <h2 id={headingId}>Subtitle timing</h2>
        <div className={styles.headerActions}>
          <Button type="button" variant="ghost" size="sm" disabled={!available || seconds === 0}
            onClick={() => changeManually(0)}>Reset</Button>
          <Button type="button" variant="ghost" size="sm" data-timing-done="" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </div>
      <RulerSlider className={styles.ruler} label="Subtitle timing" hideLabel valueStart={nudge(-1)} valueEnd={nudge(1)} value={seconds} onValueChange={changeManually}
        min={-SUBTITLE_TIMING_LIMIT} max={SUBTITLE_TIMING_LIMIT} step={0.1} largeStep={1}
        majorEvery={10} spacing={10} format={value => `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
        unit="s" disabled={!available} />
      <p id={descriptionId} className="sr-only">{description}</p>
      {mediaRef && <div className={styles.sync}>
        <div className={styles.markButtons}>
          {syncMarks.map(({ kind, label, key, Icon }) => <Button key={kind} type="button" variant="ghost"
            className={styles.markButton} disabled={!available} aria-pressed={firstMark?.kind === kind}
            aria-keyshortcuts={key} onClick={() => mark(kind)}>
            <Icon aria-hidden="true" className="size-4" /> {label}
            <Kbd aria-hidden="true" className={styles.markKey}>{key}</Kbd>
          </Button>)}
        </div>
        <p className={styles.syncStatus} role="status">{!available ? "Timing is unavailable for this subtitle track."
          : syncStatus || "Mark when you hear a line and see its subtitle, in either order."}</p>
      </div>}
    </PopoverContent>
  </Popover>;
}
