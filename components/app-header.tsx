"use client";

import { Suspense, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AdaptiveHeaderLogo } from "@/components/adaptive-header-logo";
import { useTheme } from "next-themes";
import { ArrowLeft, Home, LogIn, Puzzle, Settings } from "lucide-react";
import { useAccountAccess } from "@/contexts/account-context";
import { logout } from "@/app/actions";
import { useIsPlayerVisible } from "@/contexts/MediaPlayerContext";
import { SearchBar } from "@/components/search-component";
import { Button } from "@/components/ui/button";
import { UserMenu, type ThemePreference } from "@/components/arc/user-menu/user-menu";
import { DesktopUpdateButton } from "@/components/desktop-update-button";
import { useNavigatorShortcut } from "@/hooks/use-navigator-shortcut";
import { desktopBridge } from "@/lib/desktop/bridge";
import styles from "./app-header.module.css";
import { ProgressiveBlur } from "@/components/motion-primitives/progressive-blur";

const subscribe = () => () => {};

function ProfileMenu({ email, onSignOut = logout }: { email: string; onSignOut?: typeof logout }) {
    const router = useRouter();
    const [shortcutModifier] = useNavigatorShortcut();
    const { theme, setTheme } = useTheme();
    const mounted = useSyncExternalStore(subscribe, () => true, () => false);
    const preference: ThemePreference = mounted && theme === "system" ? "system" : mounted && theme === "light" ? "light" : "dark";

    return (
        <UserMenu
            className={styles.avatar}
            user={{ name: email.split("@")[0] || "User", email }}
            align="end"
            theme={preference}
            onThemeChange={setTheme}
            items={[
                { label: "Home", icon: <Home size={16} aria-hidden="true" />, onSelect: () => router.push("/") },
                { label: "Settings", keys: [shortcutModifier, ","], icon: <Settings size={16} aria-hidden="true" />, onSelect: () => router.push("/settings") },
                { label: "Add-ons", icon: <Puzzle size={16} aria-hidden="true" />, onSelect: () => router.push("/addons") },
                ...(mounted && ["android", "ios"].includes(desktopBridge()?.platform ?? "") ? [
                    { label: "App settings", icon: <Settings size={16} aria-hidden="true" />, onSelect: () => desktopBridge()?.send({ type: "settings" }) },
                ] : []),
            ]}
            onSignOut={onSignOut}
        />
    );
}

const phoneQuery = "(width < 48rem)";
function subscribePhone(notify: () => void) {
    const query = window.matchMedia(phoneQuery);
    query.addEventListener("change", notify);
    return () => query.removeEventListener("change", notify);
}
function HeaderSearch() {
    const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);
    const compact = phone;
    return <SearchBar key={compact ? "compact" : "full"} compact={compact} keyboardShortcut
        placeholder={compact ? "Search" : undefined} />;
}

function DetailBackButton() {
    const router = useRouter();
    return <Button variant="ghost" size="icon" className={`${styles.detailBack} size-11 rounded-full`} aria-label="Go back"
        onClick={() => window.history.length > 1 ? router.back() : router.push("/")}>
        <ArrowLeft aria-hidden="true" className="size-5" />
    </Button>;
}

export function AppHeader({ email, overlay = false, onSignOut }: {
    email: string; overlay?: boolean; onSignOut?: typeof logout;
}) {
    const { authenticated, requestSignIn } = useAccountAccess();
    const isPlayerVisible = useIsPlayerVisible();
    const headerRef = useRef<HTMLElement>(null);
    const surfaceRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const header = headerRef.current;
        const layout = header?.closest<HTMLElement>("[data-app-layout]");
        if (!header || !layout) return;
        // Includes the actual Android/iOS safe area and any font-size changes.
        const measure = () => layout.style.setProperty("--app-header-height", `${header.getBoundingClientRect().height}px`);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(header);
        const scroller = header.parentElement?.querySelector<HTMLElement>("[data-page-scroll]");
        // Fade each layer independently. Opacity on their common parent would
        // create a backdrop root and prevent the layers sampling page content.
        const surfaceLayers = surfaceRef.current?.querySelectorAll<HTMLElement>("[data-progressive-blur-layer], [data-header-tint]");
        let frame = 0;
        let previousOpacity = -1;
        const updateSurface = () => {
            frame = 0;
            // Smoothstep avoids a sharp onset or stop, even during slow scrolling.
            const progress = Math.min(1, Math.max(0, (scroller?.scrollTop ?? 0) / 192));
            const opacity = progress * progress * (3 - 2 * progress);
            if (opacity !== previousOpacity) {
                surfaceLayers?.forEach(layer => {
                    layer.style.opacity = String(opacity);
                });
                previousOpacity = opacity;
            }
        };
        const onScroll = () => {
            const top = scroller?.scrollTop ?? 0;
            if ((previousOpacity === 1 && top >= 192) || (previousOpacity === 0 && top <= 0)) return;
            if (!frame) frame = requestAnimationFrame(updateSurface);
        };
        updateSurface();
        scroller?.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            observer.disconnect();
            scroller?.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(frame);
        };
    }, [isPlayerVisible]);
    if (isPlayerVisible) return null;

    return (
        <header ref={headerRef} data-detail-header={overlay || undefined} data-window-drag-region="" className={`${styles.header} relative col-start-1 row-start-1 z-[var(--layer-header)] shrink-0 pl-[max(var(--page-gutter),env(safe-area-inset-left),var(--window-controls-inset,0px))] pr-[max(var(--page-gutter),env(safe-area-inset-right),var(--window-controls-right-inset,0px))]`}>
            <div ref={surfaceRef} className={styles.surface} aria-hidden="true">
                <ProgressiveBlur direction="top" blurLayers={6} blurIntensity={2.4} className={styles.blur} />
                <div data-header-tint="" className={styles.tint} />
            </div>
            <nav aria-label="Main navigation" className={`${styles.navigation} flex min-w-0 items-center gap-3`}>
                <Button asChild variant="ghost" size="icon" className={`${styles.home} size-11 rounded-md p-0 hover:bg-transparent dark:hover:bg-transparent`}>
                    <Link href="/" aria-label="Navigator home" draggable={false}>
                        <AdaptiveHeaderLogo adaptive />
                    </Link>
                </Button>
                {overlay && <DetailBackButton />}
                <div className={`${styles.search} min-w-0 flex-1 sm:max-w-lg`}>
                    <Suspense fallback={<div className={`${styles.searchFallback} h-11 rounded-xl bg-muted`} />}>
                        <HeaderSearch />
                    </Suspense>
                </div>
                <div className={`${styles.profile} flex h-11 shrink-0 items-center justify-center gap-3`}>
                    <DesktopUpdateButton />
                    {authenticated ? <ProfileMenu email={email} onSignOut={onSignOut} /> : (
                        <Button variant="outline" className={`${styles.guestAccount} max-sm:size-11 max-sm:p-0`} onClick={requestSignIn} aria-label="Sign in">
                            <LogIn data-icon="inline-start" aria-hidden="true" />
                            <span className="hidden sm:inline">Sign in</span>
                        </Button>
                    )}
                </div>
            </nav>
        </header>
    );
}
