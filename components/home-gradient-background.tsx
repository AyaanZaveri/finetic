"use client";

import { useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { useTheme } from "next-themes";
import { isPlayerVisibleAtom } from "@/lib/atoms";
import GradientASCII from "@/components/gradient-ascii/gradient-ascii";
import { useHomePaletteScene } from "@/components/home-palette-provider";
import { homePalette, type HomePaletteSnapshot } from "@/lib/home-palette";
import styles from "./home-gradient-background.module.css";

// sRGB avoids depending on Canvas2D support for newer CSS color syntax.
const subscribe = () => () => {};

const EMPTY: HomePaletteSnapshot = { colors: null, duration: 0 };
const getEmpty = () => EMPTY;

export function HomeGradientBackground({ dotOpacity = 0.85, visible = true, emerald = false, subdued = emerald }: { dotOpacity?: number; visible?: boolean; emerald?: boolean; subdued?: boolean }) {
    const { resolvedTheme } = useTheme();
    const light = resolvedTheme !== "dark";
    const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
    const isPlayerVisible = useAtomValue(isPlayerVisibleAtom);
    const scene = useHomePaletteScene();
    const snapshot = useSyncExternalStore(scene?.subscribe ?? subscribe, scene?.getSnapshot ?? getEmpty, getEmpty);
    const colors = homePalette(emerald ? null : snapshot.colors, light);
    const intensity = subdued ? 0.7 : 1;

    if (isPlayerVisible) return null;

    return (
        <div aria-hidden="true" hidden={!visible} data-home-gradient="" data-subdued={subdued || undefined} className={`${styles.background} pointer-events-none fixed inset-0 z-0`}>
            {/* CSS supplies both themes before hydration and during GPU loss. */}
            {hydrated && (
                <div className={`${styles.animation} absolute inset-0`}>
                    <GradientASCII
                        colors={colors}
                        colorTransitionMs={emerald ? 650 : snapshot.duration}
                        homeSurface
                        shape="horizon"
                        characters="·•●"
                        cellSize={18}
                        density={0.8}
                        speed={0.08}
                        flicker={0.05}
                        mouseInteraction={false}
                        clickEffect="none"
                        gradientOpacity={(light ? 0.18 : 0.4) * intensity}
                        glyphOpacity={dotOpacity * intensity}
                        glow={light ? 0 : 0.2}
                        grain={light ? 0 : 0.08}
                        lightMode={light}
                        dpr={1.5}
                    />
                </div>
            )}
        </div>
    );
}
