import { episodeHeroStillUrl, artworkUrl, type ArtworkKind } from "@/lib/artwork";
import { getTMDBArtwork } from "@/lib/tmdb-artwork";

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    const type = params.get("type");
    const kind = params.get("kind") as ArtworkKind;
    const width = params.get("width");
    const size = params.get("size");
    const season = params.has("season") ? Number(params.get("season")) : undefined;
    const episode = params.has("episode") ? Number(params.get("episode")) : undefined;
    if ((type !== "movie" && type !== "series")
    || (size !== null && (kind !== "still" || size !== "1280"))
    || (width !== null && (kind !== "backdrop" || !["300", "780", "1280"].includes(width)))
    || !["poster", "backdrop", "logo", "still"].includes(kind)
    || !artworkUrl(id, type, kind, season, episode)) {
        return new Response(null, { status: 400 });
    }
    const original = await getTMDBArtwork(id, type, kind, season, episode);
    if (!original) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const image = size === "1280" ? episodeHeroStillUrl(original)! : width && /^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+\//.test(original)
        ? original.replace(/\/t\/p\/[^/]+\//, `/t/p/w${width}/`) : original;
    if (params.get("sample") === "1") {
        // Public palette images need CORS, but do not need our server to transfer
        // their bytes. Only pass an already-resolved public TMDB image to wsrv.
        if (params.get("palette") === "1" && params.get("direct") !== "1" && kind !== "logo"
            && /^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+\/[\w.-]+\.(?:png|jpg|jpeg|webp)$/i.test(image)) {
            const upstream = image.replace(/\/t\/p\/[^/]+\//, `/t/p/${kind === "poster" ? "w342" : "w300"}/`);
            const proxy = new URL("https://wsrv.nl/");
            proxy.search = new URLSearchParams({ url: upstream, w: "160", output: "png" }).toString();
            return new Response(null, { status: 307, headers: {
                Location: proxy.href, "Cache-Control": "private, max-age=86400", Vary: "Cookie",
            } });
        }
        // Keep direct sampling as a fallback when the external image service
        // is unavailable, and for full-resolution logo measurements.
        try {
            const sample = params.get("palette") === "1" && kind !== "logo" && /^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+\//.test(image)
                ? image.replace(/\/t\/p\/[^/]+\//, `/t/p/${kind === "poster" ? "w342" : "w300"}/`) : image;
            const upstream = await fetch(sample, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
            const contentType = upstream.headers.get("Content-Type") ?? "";
            if (!upstream.ok || !contentType.startsWith("image/")) throw new Error("Artwork unavailable");
            return new Response(upstream.body, { headers: {
                "Content-Type": contentType, "Cache-Control": "private, max-age=86400", Vary: "Cookie",
            } });
        } catch {
            return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
        }
    }
    return new Response(null, {
        status: 307,
        headers: { Location: image, "Cache-Control": "private, max-age=86400", Vary: "Cookie" },
    });
}
