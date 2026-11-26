"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { isAIAskOpenAtom, isPlayerVisibleAtom } from "@/lib/atoms";
import { NavigatorLauncher } from "@/components/navigator/launcher";
import { preloadNavigator, preloadPlayer } from "@/lib/preload-tools";
import { desktopBridge } from "@/lib/desktop/bridge";
import { ArrowLeft } from "lucide-react";

function PlayerPending() {
    const [playing, setPlaying] = useAtom(isPlayerVisibleAtom);
    if (!playing) return null;
    // Cover the page in the same commit that hides its header/background.
    // This is the player's black surface, with no separate opening interstitial.
    return <div data-player-shell="" aria-busy="true" className="fixed inset-0 z-[var(--layer-player)] bg-black">
        <button type="button" data-player-close="" aria-label="Back to browsing" className="fixed left-4 top-4 inline-flex size-9 items-center justify-center rounded-full text-white" onClick={() => setPlaying(false)} draggable={false}>
            <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
    </div>;
}
const Player = dynamic(() => import("@/components/global-media-player").then(module => module.GlobalMediaPlayer), {
    ssr: false,
    loading: PlayerPending,
});
function NavigatorPending() {
    const [open, setOpen] = useAtom(isAIAskOpenAtom);
    const playing = useAtomValue(isPlayerVisibleAtom);
    // Off the player this stands in for the launcher pill that was just clicked.
    // The player has no pill, so showing one here flashes it before the panel.
    if (!open || playing) return null;
    return <div role="status" data-navigator-focus-ui="" className="pointer-events-none fixed inset-x-0 bottom-4 z-[var(--layer-player-navigator)] flex justify-center px-4">
        <div className="pointer-events-auto mb-0 sm:mb-1"><NavigatorLauncher busy expanded onClick={() => setOpen(false)} /></div>
    </div>;
}
const Navigator = dynamic(() => import("@/components/navigator/ai-ask"), { ssr: false, loading: NavigatorPending });

export function DeferredTools({ userId, navigatorEnabled, onToggleAIAsk }: {
    userId: string;
    navigatorEnabled: boolean;
    onToggleAIAsk: () => void;
}) {
    const playing = useAtomValue(isPlayerVisibleAtom);
    const open = useAtomValue(isAIAskOpenAtom);
    const [playerRequested, setPlayerRequested] = useState(false);
    const [navigatorRequested, setNavigatorRequested] = useState(false);
    const showNavigator = navigatorEnabled && (navigatorRequested || open);
    useEffect(() => {
        if (!["android", "windows", "macos"].includes(desktopBridge()?.platform ?? "")) return;
        // Warm the existing chunk while idle, before pointer intent or playback
        // requests it. macOS must not parse the cold player during a card hover.
        if (typeof window.requestIdleCallback === "function") {
            const idle = window.requestIdleCallback(preloadPlayer, { timeout: 1500 });
            return () => window.cancelIdleCallback(idle);
        }
        const timer = window.setTimeout(preloadPlayer, 0);
        return () => window.clearTimeout(timer);
    }, []);
    useEffect(() => {
        if (!playing || !navigatorEnabled || showNavigator) return;
        // Warm the chunk during playback to reduce the first-open delay.
        // Once Navigator is requested, its dynamic import handles loading.
        if (typeof window.requestIdleCallback === "function") {
            const idle = window.requestIdleCallback(preloadNavigator, { timeout: 3000 });
            return () => window.cancelIdleCallback(idle);
        }
        const timer = window.setTimeout(preloadNavigator, 1000);
        return () => window.clearTimeout(timer);
    }, [playing, navigatorEnabled, showNavigator]);
    // These one-way latches preserve player cleanup and chat history after first
    // use. Conditional render-time state adjustment avoids an extra effect commit.
    if (playing && !playerRequested) setPlayerRequested(true);
    if (navigatorEnabled && open && !navigatorRequested) setNavigatorRequested(true);
    return <>
        {navigatorEnabled && !playing && !showNavigator && <div data-navigator-focus-ui="" className="pointer-events-none fixed inset-x-0 bottom-4 z-[var(--layer-navigator)] flex justify-center px-4">
            <div className="pointer-events-auto mb-0 sm:mb-1"><NavigatorLauncher onClick={onToggleAIAsk} onIntent={preloadNavigator} /></div>
        </div>}
        {showNavigator && <Navigator key={userId} userId={userId} />}
        {(playerRequested || playing) && <Player onToggleAIAsk={navigatorEnabled ? onToggleAIAsk : undefined} />}
    </>;
}
