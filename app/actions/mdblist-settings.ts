"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getUser } from "@/app/actions/auth";
import { cookieRequiresHttps } from "@/lib/cookie-policy";
import { getMDBListKey, MDBLIST_KEY_COOKIE } from "@/lib/mdblist-credentials";

export type MDBListSettingsState = { configured: boolean; personal: boolean };
type MDBListSettingsResult = ({ success: true } & MDBListSettingsState) | { success: false; error: string };

export async function getMDBListSettings(): Promise<MDBListSettingsState> {
    if (!await getUser()) throw new Error("Sign in to manage MDBList settings.");
    return { configured: Boolean(await getMDBListKey()), personal: Boolean((await cookies()).get(MDBLIST_KEY_COOKIE)?.value) };
}

export async function saveMDBListKey(input: string): Promise<MDBListSettingsResult> {
    if (!await getUser()) return { success: false, error: "Sign in again to save your MDBList key" };
    const key = typeof input === "string" ? input.trim() : "";
    if (!key || key.length > 2048 || !/^[\x21-\x7e]+$/.test(key)) return { success: false, error: "Enter a valid MDBList API key" };
    try {
        const response = await fetch(`https://api.mdblist.com/user?${new URLSearchParams({ apikey: key })}`, {
            headers: { Accept: "application/json" }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
        });
        if (response.status === 401 || response.status === 403) {
            return { success: false, error: "MDBList didn’t accept this key. Check your API key and try again." };
        }
        if (!response.ok) return { success: false, error: "Couldn’t verify the key with MDBList. Try again in a moment." };
        const data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data) || data.error || data.success === false) {
            return { success: false, error: "Couldn’t verify the key with MDBList. Check the key and try again." };
        }
    } catch {
        return { success: false, error: "Couldn’t reach MDBList. Check your connection and try again." };
    }
    (await cookies()).set(MDBLIST_KEY_COOKIE, key, {
        path: "/", httpOnly: true, secure: cookieRequiresHttps(), sameSite: "lax", maxAge: 365 * 24 * 60 * 60,
    });
    revalidatePath("/", "layout");
    return { success: true, configured: true, personal: true };
}

export async function removeMDBListKey(): Promise<MDBListSettingsResult> {
    if (!await getUser()) return { success: false, error: "Sign in again to remove your MDBList key" };
    (await cookies()).delete(MDBLIST_KEY_COOKIE);
    revalidatePath("/", "layout");
    return { success: true, configured: Boolean(await getMDBListKey()), personal: false };
}
