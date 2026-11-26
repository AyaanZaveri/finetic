"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { syncBrowserConnectionCredentials } from "@/app/actions/browser-connection-credentials";
import { CONNECTION_CREDENTIALS_EVENT, CONNECTION_STORAGE_KEYS, readConnectionCredential } from "@/lib/browser-connection-credentials";

/** Browser storage owns the saved values. Cookies bridge them to metadata/image and research requests. */
export function BrowserConnectionSync() {
    const pathname = usePathname();
    const login = pathname === "/login" || (pathname.startsWith("/states/") && process.env.NODE_ENV === "development");
    const router = useRouter();
    useEffect(() => {
        if (login) return;
        let active = true;
        async function restore() {
            try {
                const tmdbToken = readConnectionCredential("tmdb");
                const tinyfishApiKey = readConnectionCredential("tinyfish");
                const mdblistApiKey = readConnectionCredential("mdblist");
                const result = await syncBrowserConnectionCredentials({ tmdbToken, tinyfishApiKey, mdblistApiKey });
                if (!active || !result.success) return;
                // A late migration response must not replace a key saved while it was in flight.
                if (result.tmdbToken !== undefined && readConnectionCredential("tmdb") === tmdbToken) {
                    localStorage.setItem(CONNECTION_STORAGE_KEYS.tmdb, result.tmdbToken);
                }
                if (result.tinyfishApiKey !== undefined && readConnectionCredential("tinyfish") === tinyfishApiKey) {
                    localStorage.setItem(CONNECTION_STORAGE_KEYS.tinyfish, result.tinyfishApiKey);
                }
                if (result.mdblistApiKey !== undefined && readConnectionCredential("mdblist") === mdblistApiKey) {
                    localStorage.setItem(CONNECTION_STORAGE_KEYS.mdblist, result.mdblistApiKey);
                }
                window.dispatchEvent(new Event(CONNECTION_CREDENTIALS_EVENT));
                if (result.changed) router.refresh();
            } catch { /* Keep browser values when storage is unavailable or the connection is offline. */ }
        }
        void restore();
        return () => { active = false; };
    }, [login, router]);
    return null;
}
