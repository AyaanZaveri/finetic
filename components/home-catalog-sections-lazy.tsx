"use client";

import { Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { MediaSection } from "@/components/media-section";
import { CATALOG_ROW_HEIGHT, HomeCatalogSkeleton } from "@/components/home-catalog-skeleton";
import { Button } from "@/components/ui/button";
import type { HomeCatalogEntry, HomeCatalogSection, InitialHomeCatalog } from "@/lib/home-catalogs";
import { HomeInitialPalette } from "@/components/home-palette-provider";
import { mediaArtwork } from "@/lib/artwork";
import { readHomeCatalogRows, retryInitialHomeCatalog } from "@/lib/home-catalog-stream";

interface HomeCatalogSectionsLazyProps {
  initialSections: HomeCatalogSection[];
  initialRows?: InitialHomeCatalog[];
  remainingEntries: HomeCatalogEntry[];
  batchSize: number;
}

function InitialCatalogRow({ row }: { row: InitialHomeCatalog }) {
  const [retry, setRetry] = useState<{ owner: InitialHomeCatalog["result"]; result: InitialHomeCatalog["result"] } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [row.result]);
  const result = use(retry?.owner === row.result ? retry.result : row.result);
  if (result.status === "error") return <section className="relative z-10 mb-8">
    <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{row.sectionName}</h2>
    <p role="alert" className="mb-3 text-sm text-muted-foreground">Could not load this catalog.</p>
    <Button variant="outline" disabled={!row.retry} onClick={() => {
      controller.current?.abort();
      controller.current = new AbortController();
      setRetry({ owner: row.result, result: retryInitialHomeCatalog(row, controller.current.signal) });
    }}>Retry</Button>
  </section>;
  const section = result.section;
  const first = section?.mediaItems[0];
  const artwork = first ? mediaArtwork(first) : null;
  return section?.mediaItems.length ? <>
    {artwork && <HomeInitialPalette primary={artwork.poster} fallback={artwork.background} />}
    <MediaSection sectionName={section.sectionName} mediaItems={section.mediaItems} />
  </> : <section className="relative z-10 mb-8">
    <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{row.sectionName}</h2>
    <p className="text-sm text-muted-foreground">No titles available in this catalog.</p>
  </section>;
}

type CatalogState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; section: HomeCatalogSection | null };

export function HomeCatalogSectionsLazy({ initialSections, initialRows, remainingEntries, batchSize }: HomeCatalogSectionsLazyProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const [catalogs, setCatalogs] = useState<Map<string, CatalogState>>(() => new Map());
  const requestRef = useRef<{ controller: AbortController; keys: string[] } | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indexes = defaultRangeExtractor(range);
    // Keep the active control mounted when pointer scrolling moves its row away.
    if (focusedRow !== null && focusedRow < range.count && !indexes.includes(focusedRow)) indexes.push(focusedRow);
    return indexes.sort((a, b) => a - b);
  }, [focusedRow]);
  const initialCount = initialRows?.length ?? initialSections.length;
  const getItemKey = useCallback((index: number) => index < initialCount
    ? (initialRows?.[index] ?? initialSections[index]).key : remainingEntries[index - initialCount].key,
  [initialCount, initialSections, initialRows, remainingEntries]);

  const virtualizer = useVirtualizer({
    count: initialCount + remainingEntries.length,
    getScrollElement: () => listRef.current?.closest<HTMLElement>("[data-page-scroll]") || null,
    estimateSize: () => CATALOG_ROW_HEIGHT,
    getItemKey,
    rangeExtractor,
    overscan: 2,
    scrollMargin: scrollMargin ?? 0,
    initialRect: { width: 0, height: Math.max(1, initialCount) * CATALOG_ROW_HEIGHT },
  });

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>("[data-page-scroll]");
    if (!list || !scroller) return;
    const update = () => setScrollMargin(Math.max(0,
      Math.round(list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(list.parentElement || list);
    return () => observer.disconnect();
  }, []);

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

  const rows = virtualizer.getVirtualItems();
  const center = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 2;
  const wantedEntries = useMemo(() => [...rows]
    .sort((a, b) => Math.abs(a.start + a.size / 2 - center) - Math.abs(b.start + b.size / 2 - center))
    .flatMap(row => remainingEntries[row.index - initialCount] ? [remainingEntries[row.index - initialCount]] : []),
  [rows, center, remainingEntries, initialCount]);

  useEffect(() => {
    if (scrollMargin === null) return;
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
  }, [wantedEntries, catalogs, batchSize, loadEntries, scrollMargin, requestVersion]);

  useEffect(() => () => requestRef.current?.controller.abort(), []);

  return (
    <div ref={listRef} data-home-catalogs="" className="relative w-full" style={{ height: virtualizer.getTotalSize(), overflowAnchor: "none" }}>
      {rows.map(row => {
        const entry = remainingEntries[row.index - initialCount];
        const state = entry ? catalogs.get(entry.key) : undefined;
        const section = row.index < initialCount ? initialSections[row.index] : state?.status === "ready" ? state.section : undefined;
        return (
          <div key={row.key} data-index={row.index} ref={virtualizer.measureElement}
            onFocusCapture={() => setFocusedRow(row.index)}
            onBlurCapture={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocusedRow(null);
            }}
            className="absolute left-0 top-0 w-full flow-root"
            aria-busy={entry && (!state || state.status === "loading") ? true : undefined}
            style={{ minHeight: CATALOG_ROW_HEIGHT, transform: `translateY(${row.start - (scrollMargin ?? 0)}px)` }}>
            {initialRows?.[row.index] ? <Suspense fallback={<div data-home-initial-pending><HomeCatalogSkeleton /></div>}>
              <InitialCatalogRow row={initialRows[row.index]} />
            </Suspense> : section ? <MediaSection sectionName={section.sectionName} mediaItems={section.mediaItems} />
              : state?.status === "error" ? <section className="relative z-10 mb-8">
                <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{entry.sectionName}</h2>
                <p role="alert" className="mb-3 text-sm text-muted-foreground">Could not load this catalog.</p>
                <Button variant="outline" disabled={Boolean(requestRef.current)} onClick={() => void loadEntries([entry])}>Retry</Button>
              </section>
              : state?.status === "ready" ? <section className="relative z-10 mb-8">
                <h2 className="mb-4 text-xl sm:text-2xl font-semibold">{entry.sectionName}</h2>
                <p className="text-sm text-muted-foreground">No titles available in this catalog.</p>
              </section>
              : <HomeCatalogSkeleton />}
          </div>
        );
      })}
    </div>
  );
}
