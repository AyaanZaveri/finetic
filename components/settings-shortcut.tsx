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
    const openSettings = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key !== "," || event.altKey || event.shiftKey || event.metaKey === event.ctrlKey) return;
      // Cancel synchronously, including repeats, before any asynchronous work.
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
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
    document.addEventListener("keydown", openSettings, { capture: true, passive: false });
    return () => document.removeEventListener("keydown", openSettings, true);
  }, [pathname, router, setAskOpen]);

  return null;
}
