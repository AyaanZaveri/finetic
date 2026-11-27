import { tmdbMediaItem } from "@/lib/tmdb-discovery";

/** Public title metadata only. Playback and account data retain their existing session gates. */
export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const id = params.get("id") || "";
    const type = params.get("type");
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (!/^tmdb:[1-9]\d{0,11}$/.test(id) || (type !== "movie" && type !== "series")) {
        return Response.json({ error: "Invalid title." }, { status: 400, headers });
    }
    try {
        const item = await tmdbMediaItem(id, type, request.signal);
        request.signal.throwIfAborted();
        return Response.json({ item: { id, type, name: item.name, poster: item.poster, background: item.background,
            logo: item.logo, description: item.description, year: item.year, releaseInfo: item.releaseInfo,
            communityRating: item.communityRating, ratingSource: item.ratingSource, genres: item.genres,
            runtime: item.runtime, cast: item.cast, seasons: item.seasons } }, { headers });
    } catch {
        return Response.json({ error: "Title metadata is unavailable." }, { status: 503, headers });
    }
}
