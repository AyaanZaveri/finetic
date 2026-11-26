"use server";

import { cookies } from "next/headers";
import { getUser } from "@/app/actions/auth";
import { cookieRequiresHttps } from "@/lib/cookie-policy";
import { TMDB_TOKEN_COOKIE } from "@/lib/tmdb-credentials";
import { TINYFISH_KEY_COOKIE } from "@/lib/tinyfish-credentials";
import { MDBLIST_KEY_COOKIE } from "@/lib/mdblist-credentials";

/** Restore browser-saved keys for server requests; migrate only personal cookies, never environment keys. */
export async function syncBrowserConnectionCredentials(input: { tmdbToken?: string; tinyfishApiKey?: string; mdblistApiKey?: string }) {
    if (!await getUser()) return { success: false as const };
    if (!input || typeof input !== "object" || Array.isArray(input)) return { success: false as const };
    for (const value of [input.tmdbToken, input.tinyfishApiKey, input.mdblistApiKey]) {
        if (value !== undefined && (typeof value !== "string" || value.length > 2048 || (value && !/^[\x21-\x7e]+$/.test(value)))) {
            return { success: false as const };
        }
    }
    const jar = await cookies();
    let changed = false;
    const sync = (name: string, value: string | undefined) => {
        const existing = jar.get(name)?.value;
        if (value === undefined) return existing;
        if (value !== (existing || "")) {
            if (value) jar.set(name, value, { path: "/", httpOnly: true, secure: cookieRequiresHttps(), sameSite: "lax", maxAge: 365 * 24 * 60 * 60 });
            else jar.delete(name);
            changed = true;
        }
        return value;
    };
    const tmdbToken = sync(TMDB_TOKEN_COOKIE, input.tmdbToken);
    const tinyfishApiKey = sync(TINYFISH_KEY_COOKIE, input.tinyfishApiKey);
    const mdblistApiKey = sync(MDBLIST_KEY_COOKIE, input.mdblistApiKey);
    return { success: true as const, tmdbToken, tinyfishApiKey, mdblistApiKey, changed };
}
