import { searchTMDBCatalog } from "@/lib/tmdb-discovery";
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
    let initialResults: SearchResultSet | undefined;
    let failure = "TMDB search is unavailable. Please try again.";
    try {
        const [movie, series, all, person] = await Promise.all([
            searchTMDBCatalog(query, undefined, "movie", 1),
            searchTMDBCatalog(query, undefined, "series", 1),
            searchTMDBCatalog(query, undefined, undefined, 1),
            searchTMDBCatalog(query, undefined, "person", 1),
        ]);
        initialResults = { page: 1, movie, series, all, person };
    } catch (error) {
        if (error instanceof Error && error.message) failure = error.message;
    }
    if (!initialResults) return <Empty role="alert" className={styles.empty}>
        <EmptyHeader><EmptyTitle>Search couldn’t load</EmptyTitle><EmptyDescription>{failure}</EmptyDescription></EmptyHeader>
        <div className={styles.emptyActions}><SearchRetryButton /><Button asChild variant="outline"><Link draggable={false} href="/settings/connections">Connection settings</Link></Button></div>
    </Empty>;
    return <SearchResultsView key={query} query={query} initialResults={initialResults} />;
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
                {query.length > 300 ? <p role="alert">Enter up to 300 characters.</p> : query ? (
                    <Suspense key={query} fallback={<SearchSectionLoading />}>
                        <SearchResults query={query} />
                    </Suspense>
                ) : (
                    <Empty className={styles.empty}><EmptyHeader>
                        <EmptyMedia variant="icon"><SearchIcon aria-hidden="true" /></EmptyMedia>
                        <EmptyTitle>Search movies, TV shows, and people</EmptyTitle>
                        <EmptyDescription>Enter a title or person’s name in the search above, or browse for something new.</EmptyDescription>
                    </EmptyHeader><Button asChild variant="secondary"><Link draggable={false} href="/">Browse titles</Link></Button></Empty>
                )}
            </div>
        </div>
    );
}
