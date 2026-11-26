"use client";

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MediaSection } from "@/components/media-section";
import { CATALOG_ROW_HEIGHT, HomeCatalogSkeleton } from "@/components/home-catalog-skeleton";
import { CachedCatalogRow } from "@/components/home-catalog-placeholder";
import { useHomeSnapshot } from "@/components/home-snapshot-provider";
import { Button } from "@/components/ui/button";
import { INITIAL_CATALOG_COUNT, type HomeCatalogEntry, type HomeCatalogSection, type InitialHomeCatalog } from "@/lib/home-catalogs";
import { HomeInitialPalette } from "@/components/home-palette-provider";
import { mediaArtwork } from "@/lib/artwork";
import { readHomeCatalogRows, retryInitialHomeCatalog } from "@/lib/home-catalog-stream";

interface HomeCatalogSectionsLazyProps {
  initialSections: HomeCatalogSection[];
  initialRows?: InitialHomeCatalog[];
  remainingEntries: HomeCatalogEntry[];
  batchSize: number;
}

function InitialCatalogRow({ row, saved }: { row: InitialHomeCatalog; saved?: HomeCatalogSection }) {
  const [retry, setRetry] = useState<{ owner: InitialHomeCatalog["result"]; result: InitialHomeCatalog["result"] } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [row.result]);
  const result = use(retry?.owner === row.result ? retry.result : row.result);
  if (result.status === "error") return <>
    {saved && <CachedCatalogRow section={saved} />}
    <section className="relative z-10 mb-8">
      {!saved && <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{row.sectionName}</h2>}
      <p role="alert" className="mb-3 text-sm text-muted-foreground">Couldn’t load this catalog</p>
      <Button variant="outline" disabled={!row.retry} onClick={() => {
        controller.current?.abort();
        controller.current = new AbortController();
        setRetry({ owner: row.result, result: retryInitialHomeCatalog(row, controller.current.signal) });
      }}>Try again</Button>
    </section>
  </>;
  const section = result.section;
  const first = section?.mediaItems[0];
  const artwork = first ? mediaArtwork(first) : null;
  return section?.mediaItems.length ? <>
    {artwork && <HomeInitialPalette primary={artwork.poster} fallback={artwork.background} />}
    <MediaSection sectionName={section.sectionName} mediaItems={section.mediaItems} />
  </> : <section className="relative z-10 mb-8">
    <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{row.sectionName}</h2>
    <p className="text-sm text-muted-foreground">No titles available in this catalog</p>
  </section>;
}

type CatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; section: HomeCatalogSection | null };

export function HomeCatalogSectionsLazy({ initialSections, initialRows, remainingEntries, batchSize }: HomeCatalogSectionsLazyProps) {
  const homeCache = useHomeSnapshot();
  const saveCatalogs = homeCache?.saveCatalogs;
  useEffect(() => {
    if (!initialRows?.length || !saveCatalogs) return;
    const revision = Date.now();
    let active = true;
    void Promise.all(initialRows.slice(0, INITIAL_CATALOG_COUNT).map(row =>
      row.result.then(result => ({ key: row.key, result }), () => ({ key: row.key, result: { status: "error" as const } })),
    )).then(rows => { if (active) saveCatalogs(rows, revision); });
    return () => { active = false; };
  }, [initialRows, saveCatalogs]);

  const listRef = useRef<HTMLDivElement>(null);
  const [nearbyKeys, setNearbyKeys] = useState<string[] | null>(null);
  const [catalogs, setCatalogs] = useState<Map<string, CatalogState>>(() => new Map());
  const requestRef = useRef<{ controller: AbortController; keys: string[] } | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const initial = initialRows ?? initialSections;
  const rowKeys = useMemo(() => [...initial.map(row => row.key), ...remainingEntries.map(entry => entry.key)], [initial, remainingEntries]);

  useEffect(() => {
    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>("[data-page-scroll]");
    if (!list || !scroller || !rowKeys.length) return;
    const nearby = new Set<HTMLElement>();
    const observer = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        const row = target as HTMLElement;
        if (isIntersecting) nearby.add(row);
        else nearby.delete(row);
      }
      if (nearby.size === 0) {
        setNearbyKeys(previous => previous?.length === 0 ? previous : []);
        return;
      }
      const viewport = scroller.getBoundingClientRect();
      const center = viewport.top + viewport.height / 2;
      const next = Array.from(nearby, row => {
        const bounds = row.getBoundingClientRect();
        return { key: row.dataset.homeCatalogRow!, distance: Math.abs(bounds.top + bounds.height / 2 - center) };
      }).sort((a, b) => a.distance - b.distance).map(row => row.key);
      setNearbyKeys(previous => previous?.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next);
    }, { root: scroller, rootMargin: `${CATALOG_ROW_HEIGHT * 2}px 0px` });
    for (const row of list.children) observer.observe(row);
    return () => observer.disconnect();
  }, [rowKeys]);

  // Render the first rows in the server stream and during hydration. Once the
  // observer reports, mount heavy rows only near the viewport or while focused.
  const mountedKeys = useMemo(() => new Set(nearbyKeys ?? rowKeys.slice(0, INITIAL_CATALOG_COUNT)), [nearbyKeys, rowKeys]);

  const loadEntries = useCallback(async (entries: HomeCatalogEntry[]) => {
    if (requestRef.current || !entries.length) return;
    const controller = new AbortController();
    const keys = entries.map(entry => entry.key);
    const request = { controller, keys };
    requestRef.current = request;
    setCatalogs(previous => {
      const next = new Map(previous);
      keys.forEach(key => next.set(key, { status: "loading" }));
      return next;
    });
    try {
      const response = await fetch("/api/home/catalogs", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ entries }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      if (response.headers?.get("Content-Type")?.includes("application/x-ndjson")) {
        const received = new Set<string>();
        await readHomeCatalogRows(response, row => {
          if (controller.signal.aborted || !keys.includes(row.key)) return;
          received.add(row.key);
          request.keys = request.keys.filter(key => key !== row.key);
          setCatalogs(previous => new Map(previous).set(row.key, row.result));
        }, controller.signal);
        if (!controller.signal.aborted) setCatalogs(previous => {
          const next = new Map(previous);
          keys.filter(key => !received.has(key)).forEach(key => next.set(key, { status: "error" }));
          return next;
        });
        return;
      }
      const data = await response.json() as { sections?: HomeCatalogSection[] };
      if (controller.signal.aborted) return;
      const sections = new Map((Array.isArray(data.sections) ? data.sections : []).map(section => [section.key, section]));
      setCatalogs(previous => {
        const next = new Map(previous);
        keys.forEach(key => next.set(key, { status: "ready", section: sections.get(key) || null }));
        return next;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Failed to load home catalogs:", error);
      setCatalogs(previous => {
        const next = new Map(previous);
        keys.forEach(key => { if (next.get(key)?.status === "loading") next.set(key, { status: "error" }); });
        return next;
      });
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        if (!controller.signal.aborted) setRequestVersion(value => value + 1);
      }
    }
  }, []);

  const wantedEntries = useMemo(() => {
    const entries = new Map(remainingEntries.map(entry => [entry.key, entry]));
    return (nearbyKeys ?? []).flatMap(key => {
      const entry = entries.get(key);
      return entry ? [entry] : [];
    });
  }, [nearbyKeys, remainingEntries]);

  useEffect(() => {
    const wanted = new Set(wantedEntries.map(entry => entry.key));
    const pending = requestRef.current;
    if (pending && pending.keys.length > 0 && !pending.keys.some(key => wanted.has(key))) {
      // A fast flick can jump past whole groups. Cancel obsolete work and load
      // the landing viewport, rather than downloading every catalog on the way.
      pending.controller.abort();
      requestRef.current = null;
      setCatalogs(previous => {
        const next = new Map(previous);
        pending.keys.forEach(key => { if (next.get(key)?.status === "loading") next.delete(key); });
        return next;
      });
    }
    if (requestRef.current) return;
    const missing = wantedEntries.filter(entry => !catalogs.has(entry.key));
    void loadEntries(missing.slice(0, Math.max(1, Math.min(batchSize, 6))));
  }, [wantedEntries, catalogs, batchSize, loadEntries, requestVersion]);

  useEffect(() => () => requestRef.current?.controller.abort(), []);

  return (
    <div ref={listRef} data-home-catalogs="" className="w-full" style={{ overflowAnchor: "none" }}>
      {rowKeys.map((key, index) => {
        const entry = remainingEntries[index - initial.length];
        const state = entry ? catalogs.get(key) : undefined;
        const section = index < initial.length ? initialSections[index] : state?.status === "ready" ? state.section : undefined;
        const mounted = mountedKeys.has(key) || focusedKey === key;
        const saved = mounted ? homeCache?.catalogs.find(entry => entry.data.key === key)?.data : undefined;
        const initialRow = initialRows?.[index];
        return (
          <div key={key} data-home-catalog-row={key}
            onFocusCapture={() => setFocusedKey(key)}
            onBlurCapture={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null);
            }}
            className="flow-root"
            aria-busy={mounted && entry && (!state || state.status === "loading") ? true : undefined}
            style={{ minHeight: CATALOG_ROW_HEIGHT }}>
            {!mounted ? <HomeCatalogSkeleton /> : initialRow ? <Suspense fallback={<div data-home-initial-pending>
              {saved ? <CachedCatalogRow section={saved} /> : <HomeCatalogSkeleton />}
            </div>}>
              <InitialCatalogRow row={initialRow} saved={saved} />
            </Suspense> : section ? <MediaSection sectionName={section.sectionName} mediaItems={section.mediaItems} />
              : state?.status === "error" ? <section className="relative z-10 mb-8">
                <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{entry.sectionName}</h2>
                <p role="alert" className="mb-3 text-sm text-muted-foreground">Couldn’t load this catalog</p>
                <Button variant="outline" disabled={Boolean(requestRef.current)} onClick={() => void loadEntries([entry])}>Try again</Button>
              </section>
              : state?.status === "ready" ? <section className="relative z-10 mb-8">
                <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{entry.sectionName}</h2>
                <p className="text-sm text-muted-foreground">No titles available in this catalog</p>
              </section>
              : <HomeCatalogSkeleton />}
          </div>
        );
      })}
    </div>
  );
}
