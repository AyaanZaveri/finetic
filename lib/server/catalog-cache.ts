import "server-only";
import { resolveArtworkList } from "./media-artwork";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { getTMDBArtworkWithToken } from "@/lib/tmdb-artwork";
import { getTMDBToken } from "@/lib/tmdb-credentials";
import { getAuthData } from "@/lib/server/auth";
import { opaqueMetadataIdentity } from "@/lib/server/metadata-cache";
import { outboundFetch } from "@/lib/server/outbound-fetch";
import type { MediaItem, StremioCatalogResponse } from "@/types/stremio";

const readArtworkToken = cache(getTMDBToken);

/** Authenticate on every read. Cache only parsed results under an opaque,
 * account/session/add-on key, never a shared public HTTP response. */
export async function readCatalog(
    transportUrl: string, type: string, catalogId: string,
    normalize: (_meta: StremioCatalogResponse["metas"][number]) => MediaItem,
    signal?: AbortSignal, maxItems = 20,
): Promise<MediaItem[]> {
    signal?.throwIfAborted();
    // Read cookies before entering the data cache and share the token across rows.
    const [session, token] = await Promise.all([getAuthData(), readArtworkToken()]);
    signal?.throwIfAborted();
    const identity = opaqueMetadataIdentity([
        session.user._id, session.issuedAt, session.authKey, transportUrl, type, catalogId, token, maxItems,
    ]);
    const read = unstable_cache(async () => {
        // A caller leaving must not cancel a cache fill used by another caller.
        const response = await outboundFetch(
            `${transportUrl.replace(/\/manifest\.json$/, "")}/catalog/${type}/${catalogId}.json`,
            { signal: AbortSignal.timeout(3500) },
        );
        if (!response.ok) throw new Error("Catalog unavailable");
        const data = await response.json() as StremioCatalogResponse;
        if (!Array.isArray(data.metas)) throw new Error("Invalid catalog response");
        const items = data.metas.slice(0, maxItems).map(normalize);
        return resolveArtworkList(items, false, (id, mediaType, kind) =>
            getTMDBArtworkWithToken(token, id, mediaType, kind));
    }, ["catalog-items-v2", identity], { revalidate: 60 });
    const items = await read();
    signal?.throwIfAborted();
    return items;
}
