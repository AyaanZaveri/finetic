"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAtomValue } from "jotai";
import { isPlayerVisibleAtom } from "@/lib/atoms";
import { AuroraBackground } from "@/components/aurora-background";
import { DEFAULT_AURORA_COLORS } from "@/lib/aurora-palette";

interface SceneOptions {
  route: string;
  amplitude: number;
  blend: number;
  opacity: number;
}
interface Scene extends SceneOptions {
  owner: symbol | null;
  colors: string[];
  paletteRoute?: string;
  hasPalette: boolean;
  ready: boolean;
  failed: boolean;
}
type Register = (_options: SceneOptions) => { resolve: (_colors: string[] | null) => void; release: () => void };
const Commands = createContext<Register | null>(null);
const CurrentScene = createContext<Scene | null>(null);

export function AuroraProvider({ children }: { children: ReactNode }) {
    const [scene, setScene] = useState<Scene>({
        route: "", amplitude: 0.8, blend: 0.4, opacity: 0.2,
        owner: null, colors: DEFAULT_AURORA_COLORS, hasPalette: false, ready: false, failed: false,
    });
    const register = useCallback<Register>((options) => {
        const owner = Symbol("aurora-page");
        setScene(current => ({ ...current, ...options, owner, ready: false, failed: false }));
        return {
            resolve(colors) {
                setScene(current => current.owner !== owner ? current : {
                    ...current, colors: colors ?? current.colors,
                    paletteRoute: colors ? current.route : current.paletteRoute,
                    hasPalette: Boolean(colors) || current.hasPalette, ready: true, failed: !colors,
                });
            },
            release() {
                // Let the next route (or Strict Mode replay) claim the surface first.
                queueMicrotask(() => setScene(current => current.owner === owner ? { ...current, owner: null } : current));
            },
        };
    }, []);
    return <Commands.Provider value={register}><CurrentScene.Provider value={scene}>{children}</CurrentScene.Provider></Commands.Provider>;
}

export function useAuroraRegistration() {
    return useContext(Commands);
}

/** Lives in the persistent scrollport, above artwork and below page content. */
export function PersistentAuroraBackground({ homePreview = false }: { homePreview?: boolean } = {}) {
    const scene = useContext(CurrentScene);
    const pathname = usePathname();
    const playing = useAtomValue(isPlayerVisibleAtom);
    if (!scene) return null;
    const home = pathname === "/" || homePreview;
    const eligible = /^\/(movie|series|person)(?:\/|$)/.test(pathname)
        || (home && scene.route === pathname && scene.paletteRoute === pathname && Boolean(scene.owner));
    const settled = scene.owner && scene.route === pathname && scene.ready;
    const opacity = eligible && scene.hasPalette && !scene.failed
        ? scene.opacity * (settled || (home && scene.paletteRoute === pathname) ? 1 : 0.25) : 0;
    return <AuroraBackground
        colorStops={scene.colors}
        amplitude={scene.amplitude}
        blend={scene.blend}
        opacity={playing ? 0 : opacity}
        className="fixed inset-0 z-[3] pointer-events-none"
    />;
}
