import "server-only";
import { cookies } from "next/headers";
import { getAuthData } from "@/lib/server/auth";

export const MDBLIST_KEY_COOKIE = "navigator-mdblist-key";

export async function getMDBListKey(): Promise<string | undefined> {
    const shared = process.env.MDBLIST_API_KEY?.trim() || undefined;
    try {
        await getAuthData();
        return (await cookies()).get(MDBLIST_KEY_COOKIE)?.value.trim() || shared;
    } catch {
        return shared;
    }
}
