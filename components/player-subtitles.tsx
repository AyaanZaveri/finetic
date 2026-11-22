"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CaptionsOff, Subtitles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuItem,
} from "@/components/arc/dropdown-menu/dropdown-menu";
import { trackOptions } from "@/lib/media/track-label";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import type { SubtitleTimingAction } from "@/components/player-settings-menu";
import styles from "./player-subtitles.module.css";

export interface ExternalSubtitleTrack {
  src: string;
  language: string;
  label: string;
  filename?: string;
  provider?: string;
  active: boolean;
}

interface EmbeddedSubtitle { id: string; language?: string; label?: string; selected: boolean }

export function PlayerSubtitles({ mediaRef, sourceKey, native, tracks, requestedSrc, onTrackChange, timing }: {
  mediaRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  native: boolean;
  tracks: ExternalSubtitleTrack[];
  requestedSrc?: string | null;
  onTrackChange(track: ExternalSubtitleTrack | null, _keepEmbedded?: boolean): void;
  timing: SubtitleTimingAction;
}) {
  const [snapshot, setSnapshot] = useState<{ tracks: EmbeddedSubtitle[]; container: HTMLElement | null }>({ tracks: [], container: null });
  const openingTiming = useRef(false);
  useEffect(() => {
    const element = mediaRef.current;
    const update = () => setSnapshot({
      tracks: native
        ? ((element as unknown as MpvElementHandle | null)?.controller?.tracks ?? [])
          .filter(track => track.type === "sub")
          .map(track => ({ id: String(track.id), language: track.lang, label: track.title, selected: Boolean(track.selected) }))
        : Array.from(element?.textTracks ?? [])
          .map((track, index) => ({ id: String(index), language: track.language, label: track.label, selected: track.mode === "showing", kind: track.kind }))
          .filter(track => track.kind === "subtitles" || track.kind === "captions"),
      container: element?.closest<HTMLElement>('[data-slot="media-player"]') ?? null,
    });
    update();
    const events = ["trackschange", "emptied", "loadedmetadata"];
    events.forEach(event => element?.addEventListener(event, update));
    const textTracks = native ? undefined : element?.textTracks;
    ["change", "addtrack", "removetrack"].forEach(event => textTracks?.addEventListener(event, update));
    return () => {
      events.forEach(event => element?.removeEventListener(event, update));
      ["change", "addtrack", "removetrack"].forEach(event => textTracks?.removeEventListener(event, update));
    };
  }, [mediaRef, sourceKey, native]);

  const embedded = trackOptions(snapshot.tracks).map(option => ({ ...option, value: `embedded:${snapshot.tracks[Number(option.value)].id}` }));
  const external = trackOptions(tracks).map(option => ({ ...option, value: `external:${option.value}` }));
  const activeExternal = tracks.findIndex(track => track.active);
  const requestedExternal = tracks.findIndex(track => track.src === requestedSrc);
  const activeEmbedded = snapshot.tracks.find(track => track.selected);
  const value = requestedExternal >= 0 ? `external:${requestedExternal}` : activeExternal >= 0 ? `external:${activeExternal}` : activeEmbedded ? `embedded:${activeEmbedded.id}` : "off";
  const select = (next: string) => {
    const [kind, id] = next.split(":");
    if (kind === "embedded" && !snapshot.tracks.some(track => track.id === id)) return;
    if (kind === "external") {
      const track = tracks[Number(id)];
      if (!track) return;
      onTrackChange(track);
    } else {
      // Cancel an in-flight download while leaving this menu in charge of the embedded track.
      onTrackChange(null, true);
      if (native) (mediaRef.current as unknown as MpvElementHandle | null)?.controller?.selectTrack("subtitle", kind === "embedded" ? id : "no");
      else Array.from(mediaRef.current?.textTracks ?? []).forEach((track, index) => {
        if (track.kind === "subtitles" || track.kind === "captions") track.mode = kind === "embedded" && String(index) === id ? "showing" : "disabled";
      });
    }
  };

  return <DropdownMenu modal={false}>
    <MediaPlayerTooltip tooltip="Subtitles" shortcut="C">
      <DropdownMenuTrigger asChild><Button type="button" variant="player-control" aria-label="Subtitles" aria-keyshortcuts="C"
        data-slot="media-player-subtitles"><Subtitles aria-hidden="true" /></Button></DropdownMenuTrigger>
    </MediaPlayerTooltip>
    <DropdownMenuContent container={snapshot.container} side="top" sideOffset={10} align="end" aria-label="Subtitles"
      data-player-native-glass="" className={styles.menu}
      onCloseAutoFocus={event => {
        if (openingTiming.current) event.preventDefault();
        openingTiming.current = false;
      }}>
      <DropdownMenuGroup>
        <ScrollArea className={styles.list}>
          <DropdownMenuRadioGroup value={value} onValueChange={select} aria-label="Subtitle track">
            <DropdownMenuRadioItem value="off" icon={<CaptionsOff size={14} aria-hidden="true" />}>Off</DropdownMenuRadioItem>
            {embedded.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel className={styles.heading}>Embedded</DropdownMenuLabel>
              {embedded.map(({ label, ...option }) => <DropdownMenuRadioItem key={option.value} {...option}>{label}</DropdownMenuRadioItem>)}</>}
            {external.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel className={styles.heading}>External</DropdownMenuLabel>
              {external.map(({ label, ...option }) => <DropdownMenuRadioItem key={option.value} {...option}
                aria-busy={option.value === `external:${requestedExternal}` || undefined}>
                {label}{option.value === `external:${requestedExternal}` && <span className={styles.summary}>Loading…</span>}
              </DropdownMenuRadioItem>)}</>}
          </DropdownMenuRadioGroup>
          {!embedded.length && !external.length && <p className={styles.empty}>No subtitle tracks available.</p>}
        </ScrollArea>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-slot="media-player-subtitle-timing" aria-haspopup="dialog"
          onSelect={() => { openingTiming.current = true; timing.onOpen(); }}>
          <span className={styles.timingLabel}>Subtitle timing</span>
          <span className={styles.summary}>{timing.seconds > 0 ? "+" : ""}{timing.seconds.toFixed(1)} s</span>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
