import { getTMDBEpisodes } from "@/lib/tmdb-discovery";
import { getMetadataProvider } from "@/lib/server/metadata-provider";

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    const season = Number(params.get("season"));
    if (!/^(?:tmdb:[1-9]\d*|tt\d+)$/.test(id) || !params.has("season") || !Number.isSafeInteger(season) || season < 0 || season > 10000) {
        return new Response(null, { status: 400 });
    }
    try {
        const useNativeTMDB = id.startsWith("tmdb:") && await getMetadataProvider() !== "cinemeta";
        const episodes = useNativeTMDB ? await getTMDBEpisodes(id, season, request.signal)
            : await (await import("@/app/actions/tv-shows")).fetchEpisodes(id, season, request.signal);
        request.signal.throwIfAborted();
        return Response.json(episodes, { headers: { "Cache-Control": "private, max-age=300", Vary: "Cookie" } });
    } catch {
        return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
}
