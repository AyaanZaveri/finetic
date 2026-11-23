"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getUser } from "@/app/actions/auth";
import { cookieRequiresHttps } from "@/lib/cookie-policy";
import { getTMDBToken, TMDB_TOKEN_COOKIE } from "@/lib/tmdb-credentials";
import { getMetadataProvider, METADATA_PROVIDER_COOKIE, type MetadataProvider } from "@/lib/server/metadata-provider";

export type ArtworkSettingsState = { configured: boolean; personal: boolean; provider: MetadataProvider };
export type ArtworkSettingsResult =
  | ({ success: true } & ArtworkSettingsState)
  | { success: false; error: string };

/** Public discovery only exposes whether a provider is configured. */
export async function getDiscoveryAvailability(): Promise<boolean> {
    return Boolean(await getTMDBToken());
}

export async function getArtworkSettings(): Promise<ArtworkSettingsState> {
    if (!await getUser()) throw new Error("Sign in to manage artwork settings.");
    const personal = !!(await cookies()).get(TMDB_TOKEN_COOKIE)?.value;
    return { configured: !!await getTMDBToken(), personal, provider: await getMetadataProvider() };
}

export async function saveMetadataProvider(provider: MetadataProvider): Promise<ArtworkSettingsResult> {
    if (!await getUser()) return { success: false, error: "Sign in again to change the metadata provider." };
    if (provider !== "auto" && provider !== "tmdb" && provider !== "cinemeta") {
        return { success: false, error: "Choose a supported metadata provider." };
    }
    const [jar, token] = await Promise.all([cookies(), getTMDBToken()]);
    if (provider === "tmdb" && !token) return { success: false, error: "Connect TMDB to use it as your metadata provider." };
    jar.set(METADATA_PROVIDER_COOKIE, provider, {
        path: "/", httpOnly: true, secure: cookieRequiresHttps(), sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60,
    });
    revalidatePath("/", "layout");
    return { success: true, provider, configured: Boolean(token), personal: !!jar.get(TMDB_TOKEN_COOKIE)?.value };
}

export async function saveArtworkToken(input: string): Promise<ArtworkSettingsResult> {
    if (!await getUser()) return { success: false, error: "Sign in again to save an artwork token." };
    const token = typeof input === "string" ? input.trim() : "";
    if (!token || token.length > 2048 || !/^[\x21-\x7e]+$/.test(token)) {
        return { success: false, error: "Enter your TMDB API Read Access Token." };
    }
    try {
        const response = await fetch("https://api.themoviedb.org/3/authentication", {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            cache: "no-store", redirect: "manual",
            signal: AbortSignal.timeout(5000),
        });
        if (response.status === 401 || response.status === 403) {
            return { success: false, error: "TMDB didn’t accept this token. Copy the API Read Access Token from your TMDB settings." };
        }
        if (!response.ok || (await response.json()).success !== true) {
            return { success: false, error: "Couldn’t verify the token with TMDB. Try again in a moment." };
        }
    } catch {
        return { success: false, error: "Couldn’t reach TMDB. Check your connection and try again." };
    }
    (await cookies()).set(TMDB_TOKEN_COOKIE, token, {
        path: "/", httpOnly: true, secure: cookieRequiresHttps(), sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60,
    });
    revalidatePath("/", "layout");
    return { success: true, configured: true, personal: true, provider: await getMetadataProvider() };
}

export async function removeArtworkToken(): Promise<ArtworkSettingsResult> {
    if (!await getUser()) return { success: false, error: "Sign in again to remove the artwork token." };
    (await cookies()).delete(TMDB_TOKEN_COOKIE);
    revalidatePath("/", "layout");
    return { success: true, configured: !!await getTMDBToken(), personal: false, provider: await getMetadataProvider() };
}
