"use client";

import { useAtomValue } from "jotai";
import { Ship } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaPlayerTooltip } from "@/components/ui/media-player";
import { useNavigatorShortcut } from "@/hooks/use-navigator-shortcut";
import { isAIAskOpenAtom } from "@/lib/atoms";

// The click zone keeps outside-pointer dismissal from racing the toggle click.
export function PlayerNavigatorButton({ onToggle }: { onToggle: () => void }) {
  const open = useAtomValue(isAIAskOpenAtom);
  const shortcut = useNavigatorShortcut();

  return (
    <MediaPlayerTooltip tooltip="Navigator" shortcut={shortcut}>
      <Button
        type="button"
        variant="player-control"
        data-navigator-click-zone=""
        aria-label="Ask Navigator"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={onToggle}
      >
        <Ship aria-hidden="true" />
      </Button>
    </MediaPlayerTooltip>
  );
}
