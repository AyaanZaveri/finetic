import "server-only";
import { cache } from "react";
import { getAuthData } from "./auth";
import { getInstalledAddons } from "@/app/actions/auth";
import { getTMDBToken } from "@/lib/tmdb-credentials";
import { opaqueMetadataIdentity } from "./metadata-cache";
import { getMetadataProvider } from "./metadata-provider";

export const metadataIdentity = cache(async () => {
    const session = await getAuthData().catch(() => null);
    const [addons, token, provider] = await Promise.all([
        session ? getInstalledAddons() : Promise.resolve([]), getTMDBToken(), getMetadataProvider(),
    ]);
    const scope = session ? `${session.user._id}:${session.issuedAt}` : "anonymous";
    return {
        scope, provider, tmdbConfigured: Boolean(token),
        revision: opaqueMetadataIdentity([scope, addons.map(addon => [addon.transportUrl, addon.manifest.id]), token, provider, "en-US"]),
    };
});
