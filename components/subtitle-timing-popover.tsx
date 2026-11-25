"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Ear, Eye, Minus, Play, Plus } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/arc/popover/popover";
import { RulerSlider } from "@/components/arc/ruler-slider/ruler-slider";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { audioDelayForMarks, normalizeSubtitleDelay, subtitleDelayForMarks, SUBTITLE_TIMING_LIMIT } from "@/lib/media/subtitle-timing";
import glass from "./arc/floating-surface.module.css";
import styles from "./subtitle-timing-popover.module.css";

const subtitleMarks = [
  { kind: "heard", label: "Heard", key: "H", Icon: Ear, tip: "Mark when you hear the line" },
  { kind: "saw", label: "Saw", key: "S", Icon: Eye, tip: "Mark when the same line’s subtitle appears" },
] as const;

const audioMarks = [
  { ...subtitleMarks[0], tip: "Mark when you hear a sound" },
  { ...subtitleMarks[1], tip: "Mark when you see the matching action" },
] as const;

type Mark = { kind: (typeof subtitleMarks)[number]["kind"]; time: number };
const otherPlayerTool = '[data-player-selection-drawer], [role="menu"], [data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"], [data-navigator-focus-ui]';

export function SubtitleTimingPopover({ open, onOpenChange, seconds, onChange, available, container, mediaRef, sourceKey, mode = "subtitle" }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  seconds: number;
  onChange(seconds: number): void;
  available: boolean;
  container?: HTMLElement | null;
  mediaRef?: RefObject<HTMLVideoElement | null>;
  sourceKey?: string;
  mode?: "subtitle" | "audio";
}) {
  const audio = mode === "audio";
  const title = audio ? "Audio delay" : "Subtitle timing";
  const syncMarks = audio ? audioMarks : subtitleMarks;
  const timingSelector = audio ? "[data-audio-timing]" : "[data-subtitle-timing]";
  const unavailable = audio ? "Audio delay is unavailable for this playback engine" : "Timing is unavailable for this subtitle track";
  const headingId = useId();
  const descriptionId = useId();
  const handingOff = useRef(false);
  const [firstMark, setFirstMark] = useState<Mark | null>(null);
  const [completedMark, setCompletedMark] = useState<Mark["kind"] | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ text: string; warning?: "paused" | "range" } | null>(null);
  useEffect(() => {
    const clear = () => {
      setFirstMark(null);
      setCompletedMark(null);
      setSyncStatus(null);
    };
    clear();
    if (!open || !available) return;
    const media = mediaRef?.current;
    const events = ["seeking", "emptied", "trackschange", ...(audio ? ["pause", "waiting", "ratechange", "beforeplaybackenginechange"] : [])];
    const onPlaying = () => setSyncStatus(current => current?.warning === "paused" ? null : current);
    events.forEach(event => media?.addEventListener(event, clear));
    media?.addEventListener("playing", onPlaying);
    media?.textTracks?.addEventListener("change", clear);
    return () => {
      events.forEach(event => media?.removeEventListener(event, clear));
      media?.removeEventListener("playing", onPlaying);
      media?.textTracks?.removeEventListener("change", clear);
    };
  }, [open, available, mediaRef, sourceKey, audio]);
  const changeManually = (value: number) => {
    setFirstMark(null);
    setCompletedMark(null);
    setSyncStatus(null);
    onChange(value);
  };
  const mark = useCallback((kind: Mark["kind"]) => {
    const media = mediaRef?.current;
    if (!open || !available || !media) return;
    if (media.paused || media.ended) {
      setSyncStatus({ text: audio ? "Play the video to mark an event" : "Play the video to mark a line", warning: "paused" });
      return;
    }
    if (media.seeking || !Number.isFinite(media.currentTime) || (audio && media.readyState < 3)) return;
    // Native position reports are batched. Measure elapsed time directly for
    // A/V marks, scaled to media seconds. Pause/rate/buffering clears the pair.
    const time = audio ? performance.now() / 1000 * media.playbackRate : media.currentTime;
    if (!firstMark || firstMark.kind === kind) {
      setCompletedMark(null);
      setFirstMark({ kind, time });
      setSyncStatus({ text: audio
        ? (kind === "heard" ? "Now mark when you see the matching action." : "Now mark when you hear the matching sound.")
        : (kind === "heard" ? "Now mark when the same subtitle appears." : "Now mark when you hear the same line.") });
      return;
    }
    const heard = kind === "heard" ? time : firstMark.time;
    const saw = kind === "saw" ? time : firstMark.time;
    const next = (audio ? audioDelayForMarks : subtitleDelayForMarks)(seconds, heard, saw);
    setFirstMark(null);
    if (next === null) {
      setSyncStatus({ text: `That offset is outside the timing range. Try another ${audio ? "event" : "line"}.`, warning: "range" });
      return;
    }
    onChange(next);
    setCompletedMark(kind);
    setSyncStatus({ text: `Timing updated. Mark another ${audio ? "event" : "line"} to refine it.` });
  }, [audio, available, firstMark, mediaRef, onChange, open, seconds]);

  useEffect(() => {
    if (!open || !mediaRef || !available) return;
    const owner = container?.ownerDocument ?? document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const action = syncMarks.find(item => item.key.toLowerCase() === event.key.toLowerCase());
      if (!action) return;
      if (event.target instanceof Element) {
        if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="listbox"]')) return;
        const dialog = event.target.closest('[role="dialog"]');
        if (dialog && !dialog.hasAttribute(audio ? "data-audio-timing" : "data-subtitle-timing")) return;
      }
      event.preventDefault();
      if (!event.repeat) mark(action.kind);
    };
    owner.addEventListener("keydown", onKeyDown, true);
    return () => owner.removeEventListener("keydown", onKeyDown, true);
  }, [audio, available, container, mark, mediaRef, open, syncMarks]);
  const trigger = container?.querySelector<HTMLElement>(audio ? '[data-slot="media-player-audio"]' : '[data-slot="media-player-subtitles"]');
  const description = !available ? `${unavailable}.`
    : seconds === 0 ? "Original timing"
      : `${audio ? "Audio plays" : "Subtitles appear"} ${Math.abs(seconds).toFixed(1)} seconds ${seconds < 0 ? "earlier" : "later"}.`;
  const nudge = (direction: -1 | 1) => <Button type="button" variant="ghost" size="icon"
    className="size-11" aria-label={`${audio ? "Play audio" : "Show subtitles"} 0.1 seconds ${direction < 0 ? "earlier" : "later"}`}
    title={direction < 0 ? "Earlier by 0.1 seconds" : "Later by 0.1 seconds"}
    disabled={!available || (direction < 0 ? seconds <= -SUBTITLE_TIMING_LIMIT : seconds >= SUBTITLE_TIMING_LIMIT)}
    onClick={() => changeManually(normalizeSubtitleDelay(seconds + direction * 0.1))}>
    {direction < 0 ? <Minus className="size-4" /> : <Plus className="size-4" />}
  </Button>;
  return <Popover open={open} onOpenChange={onOpenChange} modal={false}>
    <PopoverAnchor className={styles.anchor} aria-hidden="true" />
    <PopoverContent container={container} side="bottom" align="end" sideOffset={0} avoidCollisions={false}
      data-subtitle-timing={audio ? undefined : ""} data-audio-timing={audio ? "" : undefined} data-player-native-glass="" className={`${glass.surface} ${styles.panel}`}
      aria-labelledby={headingId} aria-describedby={descriptionId}
      onPointerDown={event => {
        if (event.button !== 0 || !(event.target instanceof Element)
          || event.target.closest('button, [role="slider"]')) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
      }}
      onOpenAutoFocus={event => {
        handingOff.current = false;
        const panel = event.currentTarget as HTMLElement;
        const target = panel.querySelector<HTMLElement>('[role="slider"]:not([aria-disabled="true"])')
          ?? panel.querySelector<HTMLElement>('[data-timing-done]');
        if (target) { event.preventDefault(); target.focus(); }
      }}
      onInteractOutside={event => {
        // Transport stays usable during sync. Entering another tool ends the
        // timing session and lets the new surface keep focus.
        const target = event.target as Element | null;
        if (target?.closest?.(otherPlayerTool)) handingOff.current = true;
        else event.preventDefault();
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const owner = container?.ownerDocument;
        const focused = owner?.activeElement;
        if (handingOff.current || !trigger?.isConnected
          || (focused && focused !== owner?.body && !focused.closest?.(timingSelector))) return;
        trigger.setAttribute("data-restoring-subtitle-focus", "");
        try {
          trigger.focus({ preventScroll: true });
        } finally {
          trigger.removeAttribute("data-restoring-subtitle-focus");
        }
      }}>
      <div className={styles.header}>
        <h2 id={headingId}>{title}</h2>
        <div className={styles.headerActions}>
          <Button type="button" variant="ghost" size="sm" disabled={!available || seconds === 0}
            onClick={() => changeManually(0)}>Reset</Button>
          <Button type="button" variant="ghost" size="sm" data-timing-done="" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </div>
      <RulerSlider className={styles.ruler} label={title} hideLabel valueStart={nudge(-1)} valueEnd={nudge(1)} value={seconds} onValueChange={changeManually}
        min={-SUBTITLE_TIMING_LIMIT} max={SUBTITLE_TIMING_LIMIT} step={0.1} largeStep={1}
        majorEvery={10} spacing={10} format={value => `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
        unit="s" disabled={!available} />
      <p id={descriptionId} className="sr-only">{description}</p>
      {mediaRef && <div className={styles.sync}>
        <div className={styles.markButtons}>
          {syncMarks.map(({ kind, label, key, Icon, tip }) => <Tooltip key={kind} delayDuration={350} disableHoverableContent>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" className={styles.markButton} disabled={!available}
                aria-pressed={firstMark?.kind === kind} data-marked={firstMark?.kind === kind || completedMark === kind ? "" : undefined}
                aria-keyshortcuts={key} onClick={() => mark(kind)}>
                <Icon aria-hidden="true" className="size-4" /> {label}
                <Kbd aria-hidden="true" className={styles.markKey}>{key}</Kbd>
              </Button>
            </TooltipTrigger>
            <TooltipContent container={container} side="bottom" sideOffset={6}
              onEscapeKeyDown={() => onOpenChange(false)}>{tip}</TooltipContent>
          </Tooltip>)}
        </div>
        <p className={syncStatus?.warning || !available ? styles.syncStatus : "sr-only"} role="status">
          {available && syncStatus?.warning === "paused" && <Play aria-hidden="true" className="size-3 shrink-0 fill-current" />}
          {!available ? unavailable
            : syncStatus?.text || (audio ? "Mark the action and its matching sound. Either order works." : "Mark the same line. Either order works.")}
        </p>
      </div>}
    </PopoverContent>
  </Popover>;
}
