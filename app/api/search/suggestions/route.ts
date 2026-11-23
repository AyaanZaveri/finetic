import { searchDiscovery } from "@/lib/discovery";

/** Keep the NDJSON envelope used by the suggestion reader. */
export async function GET(request: Request) {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (!query || query.length > 300) return new Response(null, { status: 400 });
    try {
        const result = await searchDiscovery(query, request.signal);
        request.signal.throwIfAborted();
        return new Response(JSON.stringify({ sections: [{
            key: result.provider.toLowerCase(), title: result.provider, catalogId: result.provider.toLowerCase(), catalogType: "multi", items: result.results,
        }] }) + "\n", { headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        } });
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Search is unavailable." },
            { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
}
