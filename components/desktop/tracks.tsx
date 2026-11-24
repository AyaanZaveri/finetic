"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AudioLines } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuOptions, DropdownMenuItem, DropdownMenuSeparator } from "@/components/arc/dropdown-menu/dropdown-menu";
import { Button } from "@/components/ui/button";
import { trackOptions } from "@/lib/media/track-label";
import { watchBrowserAudioSwitch } from "@/lib/media/browser-audio-switch";
import styles from "@/components/player-settings-menu.module.css";
import type { MpvElementHandle } from "@/lib/desktop/mpv-element";
import type { SubtitleTimingAction } from "@/components/player-settings-menu";
import type { NativeTrack } from "@/lib/desktop/bridge";

/** Subtitle choices live in PlayerSubtitles; this button only selects audio. */
type BrowserAudioTracks = EventTarget & ArrayLike<{ id: string; language: string; label: string; enabled: boolean }>;
type BrowserAudioMedia = HTMLVideoElement & { audioTracks?: BrowserAudioTracks };

export function DesktopTracks({ mediaRef, sourceKey, onBrowserLoadingChange, timing }: {
  mediaRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  onBrowserLoadingChange?(_loading: boolean): void;
  timing?: SubtitleTimingAction;
}) {
  const openingTiming = useRef(false);
  const pending = useRef<ReturnType<typeof watchBrowserAudioSwitch> | null>(null);
  const [snapshot, setSnapshot] = useState<{ tracks: NativeTrack[]; container: Element | null }>({ tracks: [], container: null });
  useEffect(() => {
    const node = mediaRef.current as unknown as MpvElementHandle | null;
    const browser = mediaRef.current as BrowserAudioMedia | null;
    let list = browser?.audioTracks;
    const watch = ["addtrack", "removetrack", "change"];
    const update = () => {
      const next = browser?.audioTracks;
      if (next !== list) {
        pending.current?.finish();
        pending.current = null;
        watch.forEach(name => list?.removeEventListener(name, update));
        list = next;
        watch.forEach(name => list?.addEventListener(name, update));
      }
      setSnapshot({ tracks: node?.controller?.tracks.filter(track => track.type === "audio")
      ?? Array.from(browser?.audioTracks ?? []).map((track, index) => ({ id: index, type: "audio" as const,
        lang: track.language, title: track.label, selected: track.enabled })),
      container: node?.closest('[data-slot="media-player"]') ?? null });
    };
    update();
    node?.addEventListener("trackschange", update);
    node?.addEventListener("emptied", update);
    node?.addEventListener("loadedmetadata", update);
    watch.forEach(name => list?.addEventListener(name, update));
    return () => { pending.current?.finish(); pending.current = null;
      node?.removeEventListener("trackschange", update); node?.removeEventListener("emptied", update);
      node?.removeEventListener("loadedmetadata", update);
      watch.forEach(name => list?.removeEventListener(name, update)); };
  }, [mediaRef, sourceKey]);
  const { tracks, container } = snapshot;
  if (!tracks.length && !(timing && container)) return null;
  const options = trackOptions(tracks.map(track => ({ language: track.lang, label: track.title, provider: "Embedded audio" })))
    .map(option => ({ ...option, value: String(tracks[Number(option.value)].id) }));
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="player-control" aria-label="Audio track" data-slot="media-player-audio"><AudioLines aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-player-native-glass="" container={container} side="top" sideOffset={10} align="end" aria-label="Audio track" className={styles.trackMenu}
      onCloseAutoFocus={event => {
        if (!openingTiming.current) return;
        openingTiming.current = false;
        event.preventDefault();
        timing?.onOpen();
      }}>
      {tracks.length > 0 && <DropdownMenuOptions value={String(tracks.find(track => track.selected)?.id ?? "no")} options={options}
        onValueChange={id => {
          const controller = (mediaRef.current as unknown as MpvElementHandle | null)?.controller;
          if (controller) controller.selectTrack("audio", id);
          else {
            const media = mediaRef.current as BrowserAudioMedia | null;
            const tracks = media?.audioTracks;
            const target = tracks?.[Number(id)];
            if (!media || !tracks || !target || target.enabled) return;
            pending.current?.finish();
            pending.current = onBrowserLoadingChange
              ? watchBrowserAudioSwitch(media, tracks, () => Boolean(target.enabled), onBrowserLoadingChange) : null;
            Array.from(tracks).forEach((track, index) => { track.enabled = String(index) === id; });
            pending.current?.update();
          }
        }} />}
      {timing && <>
        {tracks.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem data-slot="media-player-audio-timing" aria-haspopup="dialog"
          onSelect={() => { openingTiming.current = true; }}>
          <span className={styles.rowLabel}>Audio delay</span>
          <span className={styles.summary}>{timing.seconds > 0 ? "+" : ""}{timing.seconds.toFixed(1)} s</span>
        </DropdownMenuItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
