"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createAddonRemovalMotion } from "./addon-removal-motion";
import { AddonActions } from "@/components/addon-actions";
import { AddAddonDialog } from "@/components/add-addon-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SearchField } from "@/components/arc/search-field/search-field";
import { ChipGroup } from "@/components/arc/chip-group/chip-group";
import { ADDON_CAPABILITIES, addonTypeLabel, filterAddons, type AddonListItem } from "@/lib/addons";
import styles from "./addons-list.module.css";

export function AddonsList({ addons }: { addons: AddonListItem[] }) {
    const [query, setQuery] = useState("");
    const [capability, setCapability] = useState("all");
    const [removed, setRemoved] = useState<Set<string>>(() => new Set());
    useEffect(() => {
        // A fresh account collection can include a previously removed addon again.
        setRemoved(previous => previous.size ? new Set() : previous);
    }, [addons]);
    const search = useRef<HTMLInputElement>(null);
    const emptyTitle = useRef<HTMLDivElement>(null);
    const [rows] = useState(() => new Map<string, HTMLLIElement>());
    const [motion] = useState(() => createAddonRemovalMotion(rows));
    const pendingMotion = useRef<(() => void) | undefined>(undefined);
    const restoreFocus = useCallback(() => (search.current ?? emptyTitle.current)?.focus({ preventScroll: true }), []);
    const installed = useMemo(() => addons.filter((addon) => !removed.has(addon.id)), [addons, removed]);
    const results = useMemo(() => filterAddons(installed, query, capability), [installed, query, capability]);
    const filters = [
        { value: "all", label: "All" },
        ...ADDON_CAPABILITIES.filter((item) => installed.some((addon) => addon.capabilities.includes(item.value) || item.value === capability)),
    ];

    useEffect(() => {
        if (!removed.size) return;
        const frame = requestAnimationFrame(restoreFocus);
        return () => cancelAnimationFrame(frame);
    }, [removed, restoreFocus]);

    useLayoutEffect(() => {
        const play = pendingMotion.current;
        pendingMotion.current = undefined;
        play?.();
    }, [removed]);

    useLayoutEffect(() => { motion.cancel(); }, [motion, query, capability, addons]);

    useEffect(() => {
        window.addEventListener("resize", motion.cancel);
        document.addEventListener("scroll", motion.cancel, true);
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        preference.addEventListener("change", motion.cancel);
        return () => {
            window.removeEventListener("resize", motion.cancel);
            document.removeEventListener("scroll", motion.cancel, true);
            preference.removeEventListener("change", motion.cancel);
            motion.cancel();
        };
    }, [motion]);

    return (
        <div className={styles.directory}>
            <div className={`${styles.toolbar} [&_button[data-chip]]:backdrop-blur-md`}>
                {installed.length > 0 && <>
                    <div className={`${styles.search} rounded-xl backdrop-blur-md`}>
                        <SearchField ref={search} label="Search add-ons" hideLabel placeholder="Search add-ons…" value={query} onValueChange={setQuery} autoComplete="off" />
                    </div>
                    <div className={styles.filters}>
                        <ChipGroup label="Filter add-ons by capability" multiple={false} options={filters} value={[capability]} onValueChange={(values) => setCapability(values[0] ?? "all")} />
                    </div>
                </>}
                <div className={styles.addAction}><AddAddonDialog /></div>
            </div>

            <p role="status" aria-live="polite" className="sr-only">
                {results.length} add-on{results.length === 1 ? "" : "s"} found
            </p>

            {!installed.length ? (
                <Empty className={styles.empty}>
                    <EmptyHeader>
                        <EmptyTitle ref={emptyTitle} tabIndex={-1}>No add-ons installed</EmptyTitle>
                        <EmptyDescription>Install an add-on using its manifest link</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : results.length ? (
                <ul aria-label="Installed add-ons" className={styles.list}>
                    {results.map((addon) => {
                        const details = [...new Set(addon.types.map(addonTypeLabel))].filter(Boolean);
                        if (addon.catalogCount > 0) {
                            details.push(`${addon.catalogCount} catalog${addon.catalogCount === 1 ? "" : "s"}`);
                        }

                        return (
                            <li key={addon.id} className={styles.row} ref={element => {
                                if (element) rows.set(addon.id, element);
                                else rows.delete(addon.id);
                            }}>
                                <Avatar className={styles.logo}>
                                    {addon.logo && <AvatarImage src={addon.logo} alt="" loading="lazy" className="object-contain" />}
                                    <AvatarFallback className="rounded-xl text-sm font-medium">
                                        {addon.name.split(/\s+/u).slice(0, 2).map((word) => Array.from(word)[0]).join("")}
                                    </AvatarFallback>
                                </Avatar>
                                <div className={styles.identity}>
                                    <div className={styles.nameRow}>
                                        <h2 className={styles.name}>{addon.name}</h2>
                                        {addon.version && <span className={styles.version}>v{addon.version}</span>}
                                    </div>
                                    {addon.description && <p className={styles.description}>{addon.description}</p>}
                                    {details.length > 0 && <p className={styles.details}>{details.join(" · ")}</p>}
                                </div>
                                <div className={styles.metadata}>
                                    <div className={styles.capabilities}>
                                        {ADDON_CAPABILITIES.filter((item) => addon.capabilities.includes(item.value)).map((item) => (
                                            <Badge key={item.value} variant="secondary" className={styles.badge}>{item.label}</Badge>
                                        ))}
                                        {!ADDON_CAPABILITIES.some((item) => addon.capabilities.includes(item.value)) && <Badge variant="secondary" className={styles.badge}>Add-on</Badge>}
                                    </div>
                                    <AddonActions addon={addon} onRemovalFocus={restoreFocus} onUninstalled={({ animate }) => {
                                        try { pendingMotion.current = motion.prepare(addon.id, animate); }
                                        catch { motion.cancel(); pendingMotion.current = undefined; }
                                        setRemoved((previous) => new Set(previous).add(addon.id));
                                    }} />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <Empty className={styles.empty}>
                    <EmptyHeader>
                        <EmptyTitle>That narrows it down to… nothing</EmptyTitle>
                        <EmptyDescription>Try another search or clear the filters</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={() => { setQuery(""); setCapability("all"); }}>Clear filters</Button>
                </Empty>
            )}
        </div>
    );
}
