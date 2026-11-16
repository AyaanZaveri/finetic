import "server-only";
import { resolveArtworkList } from "./media-artwork";
import { unstable_cache } from "next/cache";
import { getAuthData } from "@/lib/server/auth";
import { opaqueMetadataIdentity } from "@/lib/server/metadata-cache";
import { outboundFetch } from "@/lib/server/outbound-fetch";
import type { MediaItem, StremioCatalogResponse } from "@/types/stremio";

/** Authenticate on every read. Cache only parsed results under an opaque,
 * account/session/add-on key, never a shared public HTTP response. */
export async function readCatalog(
    transportUrl: string, type: string, catalogId: string,
    normalize: (_meta: StremioCatalogResponse["metas"][number]) => MediaItem,
    signal?: AbortSignal, maxItems = 20,
): Promise<MediaItem[]> {
    signal?.throwIfAborted();
    const session = await getAuthData();
    const identity = opaqueMetadataIdentity([
        session.user._id, session.issuedAt, session.authKey, transportUrl, type, catalogId,
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
        return data.metas.map(normalize);
    }, ["catalog-items-v1", identity], { revalidate: 60 });
    const items = await read();
    signal?.throwIfAborted();
    return resolveArtworkList(items.slice(0, maxItems));
}
