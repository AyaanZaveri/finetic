"use client";

import React, { useState, useEffect, useRef } from "react";
import { MediaCard } from "@/components/media-card";
import { INITIAL_LIBRARY_QUERY, libraryQueryParams, type LibraryPageData, type LibrarySort } from "@/lib/library-page";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    ChevronDown,
    Search,
    Type,
    Dice6,
    Star,
    Calendar,
    ArrowUp,
    ArrowDown,
    Dices,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SortField = { value: LibrarySort; label: string };
type SortOrder = "asc" | "desc";

const getSortFieldIcon = (fieldValue: string) => {
    const iconMap: Record<string, any> = {
        name: Type,
        random: Dice6,
        rating: Star,
        year: Calendar,
    };
    return iconMap[fieldValue] || Type;
};

const sortFields: SortField[] = [
    { value: "name", label: "Name" }, { value: "random", label: "Random" },
    { value: "rating", label: "Rating" }, { value: "year", label: "Year" },
];

interface LibraryMediaListProps { initialPage: LibraryPageData; addonUrl: string }

export function LibraryMediaList({ initialPage, addonUrl }: LibraryMediaListProps) {
    const [sortField, setSortField] = useState<LibrarySort>("name");
    const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
    const [searchQuery, setSearchQuery] = useState("");
    const [seed, setSeed] = useState(0);
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [error, setError] = useState<{ key: string; message: string } | null>(null);
    const query = { search: searchQuery, sort: sortField, order: sortOrder, page, seed };
    const requestKey = libraryQueryParams(query).toString();
    const [loaded, setLoaded] = useState({ key: libraryQueryParams(INITIAL_LIBRARY_QUERY).toString(), data: initialPage });
    const rootRef = useRef<HTMLDivElement>(null);
    const busy = loaded.key !== requestKey && error?.key !== requestKey;
    const data = loaded.data;
    const pageCount = Math.max(1, Math.ceil(data.totalRecordCount / data.pageSize));

    useEffect(() => {
        if (requestKey === loaded.key) return;
        const controller = new AbortController();
        const params = new URLSearchParams(requestKey);
        params.set("addon", addonUrl);
        const timer = setTimeout(async () => {
            try {
                const response = await fetch(`/api/library?${params}`, { signal: controller.signal, cache: "no-store" });
                if (!response.ok) throw new Error("Couldn’t load this page");
                const result = await response.json() as LibraryPageData;
                controller.signal.throwIfAborted();
                setLoaded({ key: requestKey, data: result });
            } catch (cause) {
                if (!controller.signal.aborted) setError({ key: requestKey, message: cause instanceof Error ? cause.message : "Couldn’t load this page" });
            }
        }, new URLSearchParams(loaded.key).get("q") === searchQuery ? 0 : 150);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [requestKey, loaded.key, addonUrl, retry, searchQuery]);

    const handleReroll = () => { setSeed(value => (value + 1) >>> 0); setPage(1); };
    const changePage = (next: number) => {
        setPage(next);
        rootRef.current?.scrollIntoView({ block: "start" });
    };

    const selectedFieldLabel =
    sortFields.find((f) => f.value === sortField)?.label || "Name";
    const SelectedFieldIcon = getSortFieldIcon(sortField);
    const SelectedOrderIcon = sortOrder === "asc" ? ArrowUp : ArrowDown;

    return (
        <div ref={rootRef} className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                        placeholder="Search this library…"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                        maxLength={300}
                        aria-label="Search this library"
                        className="pl-9"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                                <SelectedFieldIcon className="h-4 w-4" />
                Sort: {selectedFieldLabel}
                                <ChevronDown className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            {sortFields.map((field) => {
                                const FieldIcon = getSortFieldIcon(field.value);
                                return (
                                    <DropdownMenuItem
                                        key={field.value}
                                        onClick={() => { setSortField(field.value); setPage(1); }}
                                        className={`gap-2 ${
                                            sortField === field.value ? "bg-accent" : ""
                                        }`}
                                    >
                                        <FieldIcon className="h-4 w-4" />
                                        {field.label}
                                    </DropdownMenuItem>
                                );
                            })}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {sortField !== "random" && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => { setSortOrder(sortOrder === "asc" ? "desc" : "asc"); setPage(1); }}
                        >
                            <SelectedOrderIcon className="h-4 w-4" />
                            {sortOrder === "asc" ? "Ascending" : "Descending"}
                        </Button>
                    )}

                    {sortField === "random" && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleReroll}
                                        aria-label="Shuffle titles"
                                        className="gap-2"
                                    >
                                        <Dices className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Shuffle titles</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
            </div>

            <div aria-busy={busy} className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 auto-rows-max">
                {data.items.map((item, index) => (
                    <MediaCard
                        key={`${item.type}:${item.id}:${item.addonName ?? "unknown"}:${item.catalogName ?? "unknown"}:${index}`}
                        item={item}
                        fullWidth
                    />
                ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                    {busy ? "Updating…" : `${data.totalRecordCount} items · Page ${data.page} of ${pageCount}`}
                </p>
                {pageCount > 1 && <nav aria-label="Library pages" className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={busy || data.page <= 1} onClick={() => changePage(data.page - 1)}>Previous</Button>
                    <Button variant="secondary" size="sm" disabled={busy || data.page >= pageCount} onClick={() => changePage(data.page + 1)}>Next</Button>
                </nav>}
            </div>
            {error?.key === requestKey && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
                <span>{error.message}</span><Button variant="secondary" size="sm" onClick={() => { setError(null); setRetry(value => value + 1); }}>Try again</Button>
            </div>}

            {data.totalRecordCount === 0 && !busy && (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="text-muted-foreground text-lg mb-2">
                            {searchQuery
                                ? "No matching items found"
                                : "Nothing on the shelves yet"}
                        </div>
                        <div className="text-muted-foreground text-sm">
                            {searchQuery
                                ? `No media items match “${searchQuery}”`
                                : "Try another catalog"}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
