"use client";

import { useAtom } from "jotai";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { DesktopTmdbSetupPrompt } from "@/components/desktop-tmdb-setup-prompt";
import { DeferredTools } from "@/components/deferred-tools";
import {
    isAIAskOpenAtom,
    isPlayerVisibleAtom,
    isFullscreenAtom,
    isNavigatorEnabledAtom,
} from "@/lib/atoms";
import { useSettings } from "@/contexts/settings-context";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { desktopBridge } from "@/lib/desktop/bridge";
import { AuroraProvider, PersistentAuroraBackground } from "@/components/aurora-provider";
import { HomePaletteProvider } from "@/components/home-palette-provider";
import { HomeGradientBackground } from "@/components/home-gradient-background";
import { HomeAuroraController } from "@/components/home-aurora-controller";
import { ScrollAreaRoot, ScrollAreaViewport, ScrollBar } from "@/components/ui/scroll-area";
import styles from "./layout-content.module.css";
import { useAccountAccess } from "@/contexts/account-context";

interface LayoutContentProps {
  children: ReactNode;
  email: string;
  userId?: string;
}

export function LayoutContent({ children, email, userId }: LayoutContentProps) {
    const { authenticated } = useAccountAccess();
    const pathname = usePathname();
    const seriesRoute = pathname.match(/^\/series\/([^/]+)(?:\/\d+\/\d+)?\/?$/);
    let scrollResetKey = pathname;
    if (seriesRoute) {
        // Title cards can use raw IDs, while episode links encode them. Compare
        // the same identity on the first selection as on later episode changes.
        let seriesId = seriesRoute[1];
        try { seriesId = decodeURIComponent(seriesId); } catch { /* Keep malformed escapes usable. */ }
        scrollResetKey = `/series/${encodeURIComponent(seriesId)}`;
    }
    const viewportRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        // Next's document scrolling does not reset this persistent scrollport.
        // Reset before paint so a new title opens on its hero, not the previous
        // title's recommendations. Episode changes within one series keep the
        // page position while the episode carousel handles horizontal centering.
        viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, [scrollResetKey]);
    const detailHeader = /^\/(movie|series)(?:\/|$)/.test(pathname);
    const overlayHeader = detailHeader || pathname === "/";
    const showHomeGradient = /^\/(search|person|settings|addons)(?:\/|$)/.test(pathname);
    const useEmeraldBackdrop = /^\/(settings|addons)(?:\/|$)/.test(pathname);
    const useSubduedBackdrop = useEmeraldBackdrop || /^\/person(?:\/|$)/.test(pathname);
    const [isAIAskOpen, setIsAIAskOpen] = useAtom(isAIAskOpenAtom);
    const [isFullscreen] = useAtom(isFullscreenAtom);
    const [isPlayerVisible] = useAtom(isPlayerVisibleAtom);
    const [, setIsNavigatorEnabled] = useAtom(isNavigatorEnabledAtom);
  
    const { navigatorEnabled } = useSettings();

    // Sync the navigator enabled state with the atom
    useEffect(() => {
        setIsNavigatorEnabled(authenticated && navigatorEnabled);
    }, [authenticated, navigatorEnabled, setIsNavigatorEnabled]);

    // Native fullscreen covers the whole app, so Navigator can open in place.
    // Only browser element fullscreen hides the global overlay.
    const handleToggleAIAsk = async () => {
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

    return (
        <HomePaletteProvider><AuroraProvider>
            <DesktopTmdbSetupPrompt />
            <div data-app-layout data-home-layout={pathname === "/" ? "" : undefined} className="relative flex h-dvh flex-col overflow-hidden">
                <ScrollAreaRoot type="scroll" scrollHideDelay={900} asChild>
                    <div data-desktop-app-content data-playback-hidden={isPlayerVisible ? "" : undefined} inert={isPlayerVisible} className="relative grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]">
                        <a href="#page-content" className={styles.skipLink} onClick={event => {
                            event.preventDefault();
                            viewportRef.current?.focus({ preventScroll: true });
                        }}>Skip to content</a>
                        <AppHeader email={email} overlay={detailHeader} />
                        <ScrollAreaViewport ref={viewportRef} id="page-content" role="main" aria-label="Page content" tabIndex={-1} data-page-scroll="" data-header-overlay={overlayHeader ? "true" : "false"} className={`${styles.viewport} relative z-[1] col-start-1 min-h-0 min-w-0 overscroll-contain pb-[env(safe-area-inset-bottom)] ${overlayHeader ? "row-start-1 row-span-2 [scroll-padding-top:calc(var(--app-header-height,5.25rem)+1rem)]" : "row-start-2 scroll-pt-4"}`}>
                            <PersistentAuroraBackground />
                            {pathname === "/" && <HomeAuroraController />}
                            <HomeGradientBackground visible={showHomeGradient} emerald={useEmeraldBackdrop} subdued={useSubduedBackdrop} />
                            {children}
                        </ScrollAreaViewport>
                        <ScrollBar className={styles.scrollbar} style={{ top: "var(--app-header-height, 5.25rem)", bottom: "env(safe-area-inset-bottom, 0px)" }} />
                    </div>
                </ScrollAreaRoot>
                {authenticated && <DeferredTools key={userId || email} userId={userId || email} navigatorEnabled={navigatorEnabled} onToggleAIAsk={handleToggleAIAsk} />}
            </div>
        </AuroraProvider></HomePaletteProvider>
    );
}
