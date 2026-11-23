import { discoveryHomeFeed } from "@/lib/discovery";

/** Retry one known public feed, with credentials kept entirely on the server. */
export async function GET(request: Request) {
    const feed = new URL(request.url).searchParams.get("feed") || "";
    const row = await discoveryHomeFeed(feed, request.signal);
    if (!row) return new Response("Unknown discovery feed", { status: 404 });
    const result = await row.result;
    return Response.json(result, { status: result.status === "error" ? 502 : 200,
        headers: { "Cache-Control": "private, no-store" } });
}
