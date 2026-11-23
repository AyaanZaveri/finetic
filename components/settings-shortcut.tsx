"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSetAtom } from "jotai";
import { isAIAskOpenAtom } from "@/lib/atoms";

/** Claim Settings before focused controls and the browser's default action. */
export function SettingsShortcut() {
  const router = useRouter();
  const pathname = usePathname();
  const setAskOpen = useSetAtom(isAIAskOpenAtom);

  useEffect(() => {
    const openSettings = () => {
      setAskOpen(false);
      // Use the player's normal close path so progress is saved and media stops.
      document.dispatchEvent(new Event("navigatorcloseplayer"));
      const navigate = () => {
        if (!/^\/settings(?:\/|$)/.test(pathname)) router.push("/settings");
      };
      // Browser element fullscreen hides the app routes. Native window
      // fullscreen has no fullscreenElement and can remain active.
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().then(navigate, navigate);
      } else {
        navigate();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key !== "," || event.altKey || event.shiftKey || event.metaKey === event.ctrlKey) return;
      // Cancel synchronously, including repeats, before any asynchronous work.
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) openSettings();
    };
    const onNative = () => {
      const root = document.documentElement;
      if (!root?.hasAttribute("data-desktop-settings-pending")) return;
      root.removeAttribute("data-desktop-settings-pending");
      openSettings();
    };
    document.addEventListener("keydown", onKey, { capture: true, passive: false });
    document.addEventListener("navigatoropensettings", onNative);
    onNative();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("navigatoropensettings", onNative);
    };
  }, [pathname, router, setAskOpen]);

  return null;
}
