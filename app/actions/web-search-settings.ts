"use server";

import { cookies } from "next/headers";
import { getUser } from "@/app/actions/auth";
import { cookieRequiresHttps } from "@/lib/cookie-policy";
import { getTinyfishConfig, TINYFISH_KEY_COOKIE, WEB_SEARCH_COOKIE } from "@/lib/tinyfish-credentials";
import { searchTinyfish } from "@/lib/tinyfish";

export async function getWebSearchSettings() {
    if (!await getUser()) throw new Error("Sign in to manage web search.");
    const { apiKey, enabled, personal } = await getTinyfishConfig();
    return { configured: !!apiKey, enabled, personal };
}

const cookieOptions = () => ({ path: "/", httpOnly: true, secure: cookieRequiresHttps(), sameSite: "lax" as const, maxAge: 365 * 24 * 60 * 60 });

export async function saveWebSearchKey(input: string) {
    if (!await getUser()) return { success: false as const, error: "Sign in again to save your TinyFish key" };
    const key = typeof input === "string" ? input.trim() : "";
    if (!key || key.length > 2048 || !/^[\x21-\x7e]+$/.test(key)) return { success: false as const, error: "Enter a valid TinyFish API key" };
    try {
        await searchTinyfish("The Movie Database", "Verify the web search connection for Navigator settings", key);
        (await cookies()).set(TINYFISH_KEY_COOKIE, key, cookieOptions());
        return { success: true as const, ...await getWebSearchSettings() };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Could not verify TinyFish." };
    }
}

export async function removeWebSearchKey() {
    if (!await getUser()) return { success: false as const, error: "Sign in again to remove your TinyFish key" };
    (await cookies()).delete(TINYFISH_KEY_COOKIE);
    return { success: true as const, ...await getWebSearchSettings() };
}

export async function setWebSearchEnabled(enabled: boolean) {
    if (!await getUser()) return { success: false as const, error: "Sign in again to change web search" };
    if (typeof enabled !== "boolean") return { success: false as const, error: "Choose whether to enable web search" };
    (await cookies()).set(WEB_SEARCH_COOKIE, enabled ? "1" : "0", cookieOptions());
    return { success: true as const, ...await getWebSearchSettings() };
}
