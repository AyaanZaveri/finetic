"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { MediaCard } from "@/components/media-card";
import { Button } from "@/components/ui/button";
import { FILMOGRAPHY_BATCH, personCreditWindow, personFilter, personSort, type PersonCredit } from "@/lib/person-filmography";
import styles from "./person-page.module.css";

export function PersonFilmography({ id, items }: { id: number; items: PersonCredit[] }) {
    const params = useSearchParams();
    const type = personFilter(params.get("type")), sort = personSort(params.get("sort"));
    const key = `${type}:${sort}`;
    const [limits, setLimits] = useState<Record<string, number>>(() => ({ [key]: FILMOGRAPHY_BATCH }));
    const source = useMemo(() => personCreditWindow(items, type, sort, limits), [items, type, sort, limits]);
    const sentinel = useRef<HTMLDivElement>(null);
    const loadMore = () => setLimits(previous => ({ ...previous, [key]: Math.min(source.total, (previous[key] || FILMOGRAPHY_BATCH) + FILMOGRAPHY_BATCH) }));
    useEffect(() => {
        const target = sentinel.current;
        if (!target || !source.hasMore) return;
        if (typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                observer.disconnect();
                setLimits(previous => ({ ...previous, [key]: Math.min(source.total, (previous[key] || FILMOGRAPHY_BATCH) + FILMOGRAPHY_BATCH) }));
            }
        }, { root: target.closest("[data-page-scroll]"), rootMargin: "600px 0px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [key, source.hasMore, source.total, source.shown.size]);
    const change = (nextType: string, nextSort: string) => {
        const nextKey = `${nextType}:${nextSort}`;
        setLimits(previous => ({ ...previous, [nextKey]: previous[nextKey] || FILMOGRAPHY_BATCH }));
        const query = new URLSearchParams();
        if (nextType !== "all") query.set("type", nextType);
        if (nextSort !== "newest") query.set("sort", nextSort);
        window.history.pushState(null, "", `/person/${id}${query.size ? `?${query}` : ""}`);
    };
    return <>
        <div className={styles.heading}>
            <h2 id="filmography-heading">Filmography</h2>
            <span className={styles.count} role="status">{source.total.toLocaleString("en-US")} {source.total === 1 ? "title" : "titles"}</span>
        </div>
        <div className={styles.toolbar}>
            <SegmentedControl label="Filmography type" value={type} options={[
                { value: "all", label: "All" }, { value: "movie", label: "Movies" }, { value: "series", label: "Shows" },
            ]} onValueChange={value => change(value, sort)} />
            <SegmentedControl label="Sort filmography" value={sort} options={[
                { value: "newest", label: "Newest" }, { value: "popular", label: "Most popular" },
            ]} onValueChange={value => change(type, value)} />
        </div>
        <ul aria-label="Filmography" className={styles.grid} hidden={!source.total}>
            {source.ordered.map(identity => {
                const item = source.pool.get(identity)!;
                return <li key={identity} hidden={!source.shown.has(identity)}>
                    <MediaCard item={item} fullWidth titleLines={2} revealArtwork={false}
                        subtitleContent={<>{item.year ? `${item.year} · ` : ""}{item.type === "movie" ? "Movie" : "TV Series"}</>} />
                </li>;
            })}
        </ul>
        {!source.total && <div className={styles.message}><p>No credits listed on TMDB for this selection</p>
            {type !== "all" && <Button variant="outline" onClick={() => change("all", sort)}>Show all credits</Button>}
        </div>}
        {source.hasMore && <div ref={sentinel} className={styles.loadStatus}>
            <Button variant="ghost" className={styles.loadMore} onClick={loadMore}>Load more titles</Button>
        </div>}
    </>;
}
