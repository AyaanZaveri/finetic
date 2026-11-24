"use client";

import { useAtom } from "jotai";
import {
  isAIAskOpenAtom,
  isFullscreenAtom,
  isNavigatorEnabledAtom,
} from "@/lib/atoms";
import { useEffect } from "react";
import { desktopBridge } from "@/lib/desktop/bridge";

export function KeyboardShortcuts() {
  const [isAIAskOpen, setIsAIAskOpen] = useAtom(isAIAskOpenAtom);
  const [isFullscreen] = useAtom(isFullscreenAtom);
  const [isNavigatorEnabled] = useAtom(isNavigatorEnabledAtom);

  // Function to handle opening AI Ask with fullscreen exit if needed
  const handleToggleAIAsk = async () => {
    // Don't handle shortcuts if navigator is disabled
    if (
      !isNavigatorEnabled ||
      document.activeElement?.closest("[data-navigator-click-zone]")
    ) {
      return;
    }

    if (isFullscreen && !isAIAskOpen && !desktopBridge()) {
      // Exit fullscreen first when opening AI Ask
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
        // Wait a bit for fullscreen to exit, then open AI Ask
        setTimeout(() => {
          setIsAIAskOpen(true);
        }, 100);
      } catch (error) {
        console.warn("Failed to exit fullscreen:", error);
        // Still try to open AI Ask even if fullscreen exit fails
        setIsAIAskOpen((prev) => !prev);
      }
    } else {
      setIsAIAskOpen((prev) => !prev);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !isNavigatorEnabled ||
        (event.target instanceof Element &&
          event.target.closest("[data-navigator-click-zone], [data-player-selection-drawer]"))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        void handleToggleAIAsk();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && event.key === "Escape" && isAIAskOpen) {
        setIsAIAskOpen(false);
      }
    };
    // Claim the app shortcut before focused player controls consume K.
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  });

  return null;
}
