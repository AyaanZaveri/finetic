import "server-only";
import { cookies } from "next/headers";

export type MetadataProvider = "auto" | "tmdb" | "cinemeta";
export const METADATA_PROVIDER_COOKIE = "navigator-metadata-provider";

export async function getMetadataProvider(): Promise<MetadataProvider> {
    const value = (await cookies()).get(METADATA_PROVIDER_COOKIE)?.value;
    return value === "tmdb" || value === "cinemeta" ? value : "auto";
}
