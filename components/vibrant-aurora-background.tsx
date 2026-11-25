"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { AuroraBackground } from "@/components/aurora-background";
import { useAuroraRegistration } from "@/components/aurora-provider";
import { loadAuroraPalette } from "@/lib/aurora-palette-loader";
import { DEFAULT_AURORA_COLORS } from "@/lib/aurora-palette";

interface VibrantAuroraBackgroundProps {
  backdropUrl?: string;
  posterUrl?: string;
  className?: string;
  amplitude?: number;
  blend?: number;
  opacity?: number;
}

export function VibrantAuroraBackground({
    backdropUrl, posterUrl,
    className = "fixed inset-0 z-[3] pointer-events-none",
    amplitude = 0.8, blend = 0.4, opacity = 0.3,
}: VibrantAuroraBackgroundProps) {
    const register = useAuroraRegistration();
    const pathname = usePathname();
    const { resolvedTheme } = useTheme();
    const [local, setLocal] = useState({ colors: DEFAULT_AURORA_COLORS, opacity: 0 });

    useEffect(() => {
        if (resolvedTheme !== "dark") return;
        let cancelled = false;
        const registration = register?.({ route: pathname, amplitude, blend, opacity });
        void loadAuroraPalette(backdropUrl, posterUrl).then(colors => {
            if (cancelled) return;
            if (registration) registration.resolve(colors);
            else setLocal(current => ({ colors: colors ?? current.colors, opacity: colors ? opacity : 0 }));
        });
        return () => { cancelled = true; registration?.release(); };
    }, [backdropUrl, posterUrl, pathname, amplitude, blend, opacity, register, resolvedTheme]);

    // Main routes only register their palette. Login retains a standalone surface.
    if (register) return null;
    return <AuroraBackground amplitude={amplitude} blend={blend} className={className} colorStops={local.colors} opacity={local.opacity} />;
}
