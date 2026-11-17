import { searchTMDBCatalog } from "@/lib/tmdb-discovery";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Fetch only the next page of the selected TMDB ranking. Credentials stay on
 * the server; public search works for guests just like the initial page. */
export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim() ?? "";
    const type = params.get("type") ?? "all";
    const page = Number(params.get("page") ?? "1");
    if (!query || query.length > 300 || !["all", "movie", "series", "person"].includes(type)
        || !Number.isSafeInteger(page) || page < 1 || page > 500) {
        return Response.json({ error: "Invalid search request." }, { status: 400, headers });
    }
    try {
        const result = await searchTMDBCatalog(query, request.signal, type === "movie" || type === "series" || type === "person" ? type : undefined, page);
        request.signal.throwIfAborted();
        return Response.json(result, { headers });
    } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499, headers });
        return Response.json({ error: error instanceof Error ? error.message : "TMDB search is unavailable." }, { status: 503, headers });
    }
}
