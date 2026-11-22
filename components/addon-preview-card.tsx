"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Puzzle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ADDON_CAPABILITIES, type AddonListItem } from "@/lib/addons";
import { loadHomePalette } from "@/lib/aurora-palette-loader";
import styles from "./addon-preview.module.css";

type PreviewAddon = Pick<AddonListItem, "name" | "version" | "description" | "logo" | "capabilities">;

export function AddonPreviewCard({ addon, children }: { addon: PreviewAddon; children?: ReactNode }) {
    const [palette, setPalette] = useState<{ source: string; color: string } | null>(null);
    const source = addon.logo;
    useEffect(() => {
        if (!source) return;
        let active = true;
        void loadHomePalette(source).then(colors => {
            if (active && colors?.[0]) setPalette({ source, color: colors[0] });
        }).catch(() => { /* Keep the neutral gradient if the logo cannot be sampled. */ });
        return () => { active = false; };
    }, [source]);
    const capabilities = ADDON_CAPABILITIES.filter(item => addon.capabilities.includes(item.value));

    return <section aria-label="Addon preview" aria-live="polite"
        className={`${styles.card} flex min-w-0 flex-col gap-4 rounded-xl border p-4`}
        style={palette && palette.source === source ? { "--addon-color": palette.color } as CSSProperties : undefined}>
        <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-10 shrink-0 rounded-[10px]">
                {source && <AvatarImage src={source} alt="" referrerPolicy="no-referrer" draggable={false} className="object-contain" />}
                <AvatarFallback className="rounded-[10px] bg-transparent text-muted-foreground"><Puzzle aria-hidden="true" className="size-5" /></AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <h2 className="wrap-anywhere text-base font-semibold leading-[1.3]">{addon.name}</h2>
                {addon.version && <span className="wrap-anywhere text-base font-normal leading-[1.3] text-muted-foreground">v{addon.version}</span>}
            </div>
        </div>
        {addon.description && <p className="wrap-anywhere text-sm leading-[1.5] text-pretty text-muted-foreground">{addon.description}</p>}
        {capabilities.length > 0 && <div className="flex flex-wrap gap-1.5">
            {capabilities.map(item => (
                <Badge key={item.value} variant="outline" className="text-xs text-muted-foreground">{item.label}</Badge>
            ))}
        </div>}
        {children}
    </section>;
}
