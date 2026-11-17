import { searchTMDBCatalog } from "@/lib/tmdb-discovery";

/** One TMDB multi-search; the NDJSON envelope keeps the existing suggestion reader. */
export async function GET(request: Request) {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 300) return new Response(null, { status: 400 });
    try {
        const result = await searchTMDBCatalog(query, request.signal);
        request.signal.throwIfAborted();
        return new Response(JSON.stringify({ sections: [{
            key: "tmdb", title: "TMDB", catalogId: "tmdb", catalogType: "multi", items: result.results,
        }] }) + "\n", { headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        } });
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "TMDB search is unavailable." },
            { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
}
