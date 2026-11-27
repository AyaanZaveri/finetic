import { getMediaCast } from "@/lib/tmdb-cast";
import { getTMDBContentRating, getTMDBEpisodes, tmdbMediaItem } from "@/lib/tmdb-discovery";

/** Public title metadata only. Playback and account data retain their existing session gates. */
export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const id = params.get("id") || "";
    const type = params.get("type");
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    const certificationOnly = params.get("certification") === "1";
    const validId = certificationOnly ? /^(?:tt\d{1,12}|tmdb:[1-9]\d{0,11})$/.test(id) : /^tmdb:[1-9]\d{0,11}$/.test(id);
    if (!validId || (type !== "movie" && type !== "series")) {
        return Response.json({ error: "Invalid title." }, { status: 400, headers });
    }
    try {
        if (certificationOnly) {
            const contentRating = await getTMDBContentRating(id, type, request.signal);
            return Response.json({ contentRating }, { headers });
        }
        const seasonParam = params.get("season");
        if (seasonParam !== null) {
            const season = Number(seasonParam);
            if (type !== "series" || !/^\d{1,4}$/.test(seasonParam) || !Number.isSafeInteger(season)) return Response.json({ error: "Invalid season." }, { status: 400, headers });
            const episodes = await getTMDBEpisodes(id, season, request.signal);
            return Response.json({ episodes }, { headers });
        }
        const item = await tmdbMediaItem(id, type, request.signal);
        const cast = await getMediaCast(id, type, item.cast).catch(() => undefined);
        request.signal.throwIfAborted();
        return Response.json({ item: { id, type, name: item.name, poster: item.poster, background: item.background,
            logo: item.logo, description: item.description, year: item.year, releaseInfo: item.releaseInfo, released: item.released || item.releaseInfo, contentRating: item.contentRating,
            communityRating: item.communityRating, ratingSource: item.ratingSource, genres: item.genres,
            runtime: item.runtime, cast: item.cast, director: item.director, writer: item.writer, castMembers: cast?.members, seasons: item.seasons } }, { headers });
    } catch {
        return Response.json({ error: "Title metadata is unavailable." }, { status: 503, headers });
    }
}
