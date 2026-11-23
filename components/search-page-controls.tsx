"use client";

import { useLayoutEffect, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Button } from "@/components/ui/button";
import { type SearchMediaFilter } from "@/lib/search-presentation";
import styles from "./search-page.module.css";

export function SearchPageHeading({ query }: { query: string }) {
    const params = useSearchParams();
    const filter = params.get("type") || "all";
    const heading = useRef<HTMLHeadingElement>(null);
    const previous = useRef({ query, filter });
    useLayoutEffect(() => {
        document.title = query ? `Search: ${query.slice(0, 100)} · Navigator` : "Search · Navigator";
        if (previous.current.query !== query || previous.current.filter !== filter) {
            document.querySelector<HTMLElement>("[data-page-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
            if (previous.current.query !== query) heading.current?.focus({ preventScroll: true });
        }
        previous.current = { query, filter };
    }, [query, filter]);
    return <header className={styles.heading}>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
            {query ? <>Results for “{query}”</> : "Find your next watch"}
        </h1>
    </header>;
}

export function SearchTypeFilters({ value, movies, shows, people, onValueChange }: {
    value: SearchMediaFilter; movies: number; shows: number; people?: number; onValueChange: (_value: string) => void;
}) {
    const badge = (count: number) => <span className={styles.badge}>{count.toLocaleString("en-US")}</span>;
    return <div className={styles.filters}>
        <SegmentedControl label="Result type" value={value} options={[
            { value: "all", label: "All", accessory: badge(movies + shows + (people ?? 0)) },
            { value: "movie", label: "Movies", accessory: badge(movies) },
            { value: "series", label: "TV shows", accessory: badge(shows) },
            ...(people === undefined ? [] : [{ value: "person", label: "People", accessory: badge(people) }]),
        ]} onValueChange={onValueChange} />
    </div>;
}

export function SearchRetryButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return <Button variant="secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending ? "Trying again…" : "Try again"}
    </Button>;
}
