"use client";

import { useState } from "react";
import {
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
  DropdownMenuOptions, type DropdownOption,
} from "@/components/arc/dropdown-menu/dropdown-menu";
import styles from "./player-settings-menu.module.css";

export interface SubtitleTimingAction {
  seconds: number;
  open?: boolean;
  onOpen(): void;
  onClose(): void;
}

export function PlayerSettingsMenu({ speed, speeds, onSpeedChange, quality, subtitles, subtitleTiming, disabled, portalContainer }: {
  speed: number;
  speeds: number[];
  onSpeedChange(_rate: number): void;
  quality?: { value: string; options: DropdownOption[]; onChange(_value: string): void };
  subtitles?: { value: string; options: DropdownOption[]; onChange(_value: string): void };
  subtitleTiming?: SubtitleTimingAction;
  disabled?: boolean;
  portalContainer: Element | DocumentFragment | null;
}) {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const activateSubmenu = (label: string) => {
    if (disabled) return;
    subtitleTiming?.onClose();
    setOpenSubmenu(label);
  };
  const rows = [
    { label: "Speed", value: String(speed), summary: `${speed}×`, options: speeds.map(rate => ({ value: String(rate), label: rate === 1 ? "Normal (1×)" : `${rate}×` })), onChange: (value: string) => onSpeedChange(Number(value)) },
    ...(quality ? [{ label: "Quality", ...quality, summary: quality.options.find(option => option.value === quality.value)?.label ?? "Auto" }] : []),
    ...(subtitles ? [{ label: "Subtitles", ...subtitles, summary: subtitles.options.find(option => option.value === subtitles.value)?.label ?? "Off" }] : []),
  ];
  return <>{rows.map(row => <DropdownMenuSub key={row.label}
    open={!subtitleTiming?.open && openSubmenu === row.label}
    onOpenChange={next => {
      // A pinned timing panel ignores submenu hover. Explicit activation below
      // swaps it out; regular submenu hover still works when timing is closed.
      if (subtitleTiming?.open) return;
      setOpenSubmenu(current => next ? row.label : current === row.label ? null : current);
    }}>
    <DropdownMenuSubTrigger disabled={disabled}
      onClick={() => { if (subtitleTiming?.open) activateSubmenu(row.label); }}
      onKeyDown={event => {
        if (subtitleTiming?.open && ["Enter", " ", "ArrowRight", "ArrowLeft"].includes(event.key)) {
          // Radix supports the arrow pointing toward the submenu in either
          // writing direction. Leave the opposite arrow's close behavior alone.
          const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === "rtl";
          if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) return;
          event.preventDefault();
          activateSubmenu(row.label);
        }
      }}>
      <span className={styles.rowLabel}>{row.label}</span>
      <span className={styles.summary}>{row.summary}</span>
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent data-player-native-glass="" container={portalContainer} aria-label={row.label}
      className={row.label === "Subtitles" ? styles.subtitleMenu : undefined}>
      <DropdownMenuOptions value={row.value} onValueChange={row.onChange} options={row.options} separateFirst={row.label === "Subtitles"} />
      {row.label === "Subtitles" && row.options.length === 1 && <p className={styles.empty}>No subtitle tracks available</p>}
    </DropdownMenuSubContent>
  </DropdownMenuSub>)}
  </>;
}
