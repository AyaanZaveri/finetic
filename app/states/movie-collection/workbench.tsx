"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { MovieCollectionSection } from "@/components/media-page/movie-collection-section";
import { AccountProvider } from "@/components/account-provider";
import { JotaiProvider } from "@/components/jotai-provider";
import type { MovieCollection } from "@/lib/tmdb-discovery";
import data from "./fixture.json";
import companiesData from "./companies.json";
import { ProductionCompaniesSection } from "@/components/media-page/production-companies-section";
import styles from "./states.module.css";

const groups = [
    { title: "Collection", states: [
        { id: "ready", label: "Full collection" },
        { id: "single", label: "One related movie" },
        { id: "unavailable", label: "No collection / unavailable" },
    ] },
    { title: "Production companies", states: [
        { id: "companies-ready", label: "All companies" },
        { id: "companies-missing-logo", label: "Missing logo" },
        { id: "companies-single", label: "One company" },
        { id: "companies-empty", label: "No companies" },
    ] },
    { title: "Artwork", states: [
        { id: "no-english", label: "No English backdrop" },
        { id: "poster-only", label: "Poster only" },
        { id: "no-artwork", label: "No artwork" },
    ] },
] as const;
const states = groups.flatMap(group => [...group.states]);

function Workbench() {
    const params = useSearchParams();
    const active = states.find(state => state.id === params.get("__state"))?.id ?? "ready";
    const [hidden, setHidden] = useState(false);
    const choose = (id: string) => {
        const url = new URL(location.href);
        url.searchParams.set("__state", id);
        history.pushState(null, "", url);
    };
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
                (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))) return;
            if (event.key.toLowerCase() === "h") { setHidden(value => !value); return; }
            const step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            choose(states[(states.findIndex(state => state.id === active) + step + states.length) % states.length].id);
        };
        window.addEventListener("keydown", key);
        return () => window.removeEventListener("keydown", key);
    }, [active]);
    const collection: MovieCollection | null = active === "unavailable" ? null : {
        name: data.name,
        parts: (active === "single" ? data.parts.slice(0, 1) : data.parts).map((part, index) => ({
            item: {
                ...part.item, type: "movie",
                background: index === 0 && ["poster-only", "no-artwork"].includes(active) ? undefined : part.item.background,
                poster: index === 0 && active === "no-artwork" ? undefined : part.item.poster,
            },
            backdrop: index === 0 && ["no-english", "poster-only", "no-artwork"].includes(active) ? undefined : part.backdrop,
        })),
    };
    const companies = active === "companies-empty" ? [] : (active === "companies-single" ? companiesData.slice(0, 1) : companiesData)
        .map((company, index) => ({ ...company, logo: active === "companies-missing-logo" && index === 0 ? undefined : company.logo }));
    return <div className={styles.page} data-switcher-hidden={hidden || undefined}>
        <div className={styles.layout}>
            <nav className={styles.switcher} aria-label="States">
                {groups.map(group => <div key={group.title} role="group" aria-labelledby={`group-${group.title}`} className={styles.group}>
                    <span id={`group-${group.title}`} className={styles.heading}><CornerDownRight size={12} aria-hidden="true" />{group.title}</span>
                    {group.states.map(state => <button key={state.id} aria-pressed={active === state.id} onClick={() => choose(state.id)}>{state.label}</button>)}
                </div>)}
            </nav>
            <div className={styles.select}>
                <select aria-label="State" value={active} onChange={event => choose(event.target.value)}>
                    {groups.map(group => <optgroup key={group.title} label={group.title}>
                        {group.states.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}
                    </optgroup>)}
                </select>
                <ChevronDown size={12} aria-hidden="true" />
            </div>
            <div className={styles.stage}>
                <JotaiProvider><AccountProvider authenticated={false}>
                    <ProductionCompaniesSection key={`companies:${active}`} companies={companies} />
                    <MovieCollectionSection key={`collection:${active}`} collection={collection} />
                </AccountProvider></JotaiProvider>
            </div>
        </div>
    </div>;
}

export default function CollectionWorkbench() {
    return <Suspense><Workbench /></Suspense>;
}
