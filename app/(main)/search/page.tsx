import { searchDiscovery } from "@/lib/discovery";
import { SearchResultsView } from "@/components/search-results-view";
import { SearchSectionLoading } from "@/components/search-section-loading";
import { SearchIcon } from "lucide-react";
import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SearchPageHeading, SearchRetryButton } from "@/components/search-page-controls";
import type { SearchResultSet } from "@/lib/search-presentation";
import styles from "@/components/search-page.module.css";

function first(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value)?.trim() || "";
}

async function SearchResults({ query }: { query: string }) {
    let peopleAvailable = true;
    let initialResults: SearchResultSet | undefined;
    let failure = "Search is unavailable. Try again.";
    try {
        const [movie, series, all, person] = await Promise.all([
            searchDiscovery(query, undefined, "movie", 1),
            searchDiscovery(query, undefined, "series", 1),
            searchDiscovery(query, undefined, undefined, 1),
            searchDiscovery(query, undefined, "person", 1),
        ]);
        peopleAvailable = all.provider === "TMDB";
        initialResults = { page: 1, movie, series, all, person };
    } catch (error) {
        if (error instanceof Error && error.message) failure = error.message;
    }
    if (!initialResults) return <Empty role="alert" className={styles.empty}>
        <EmptyHeader><EmptyTitle>Couldn’t load search results</EmptyTitle><EmptyDescription>{failure}</EmptyDescription></EmptyHeader>
        <div className={styles.emptyActions}><SearchRetryButton /><Button asChild variant="outline"><Link draggable={false} href="/settings/connections">Connection settings</Link></Button></div>
    </Empty>;
    return <SearchResultsView key={query} query={query} initialResults={initialResults} peopleAvailable={peopleAvailable} />;
}

export default async function Search({ searchParams }: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const params = await searchParams;
    const query = first(params.q);
    return (
        <div className={styles.page}>
            <div className={styles.content}>
                <SearchPageHeading query={query.length > 300 ? "" : query} />
                {query.length > 300 ? <p role="alert">Enter up to 300 characters</p> : query ? (
                    <Suspense key={query} fallback={<SearchSectionLoading />}>
                        <SearchResults query={query} />
                    </Suspense>
                ) : (
                    <Empty className={styles.empty}><EmptyHeader>
                        <EmptyMedia variant="icon"><SearchIcon aria-hidden="true" /></EmptyMedia>
                        <EmptyTitle>Search movies, TV shows, and people</EmptyTitle>
                        <EmptyDescription>Search for a title or person, or browse titles</EmptyDescription>
                    </EmptyHeader><Button asChild variant="secondary"><Link draggable={false} href="/">Browse titles</Link></Button></Empty>
                )}
            </div>
        </div>
    );
}
