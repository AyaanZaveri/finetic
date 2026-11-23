"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { getDiscoveryAvailability } from "@/app/actions/artwork-settings";
import { useAccountAccess } from "@/contexts/account-context";
import { desktopBridge } from "@/lib/desktop/bridge";
import { CONNECTION_CREDENTIALS_EVENT, readConnectionCredential } from "@/lib/browser-connection-credentials";

const storageKey = "navigator-tmdb-intro-v1";

export function DesktopTmdbSetupPrompt() {
    const pathname = usePathname();
    const router = useRouter();
    const { authenticated, requestSignIn } = useAccountAccess();
    const shown = useRef(false);

    useEffect(() => {
        const platform = desktopBridge()?.platform;
        if (!platform || !["macos", "windows", "linux"].includes(platform)) return;
        const savedLocally = () => {
            try { return Boolean(readConnectionCredential("tmdb")?.trim()); }
            catch { return false; }
        };
        const onCredentials = () => { if (savedLocally()) toast.dismiss(storageKey); };
        window.addEventListener(CONNECTION_CREDENTIALS_EVENT, onCredentials);
        let active = true;

        async function check() {
            if (pathname !== "/" || shown.current || savedLocally()) return;
            try { if (localStorage.getItem(storageKey)) return; } catch { /* Use the mounted ref when storage is unavailable. */ }
            try {
                if (await getDiscoveryAvailability() || !active || savedLocally()) return;
                shown.current = true;
                try { localStorage.setItem(storageKey, "1"); } catch { /* The ref still prevents repeats. */ }
                toast("Add TMDB for more discovery options", {
                    id: storageKey,
                    description: "Browse and search with Cinemeta. Connect TMDB for people search and streaming availability.",
                    closeButton: true,
                    action: authenticated
                        ? { label: "Configure TMDB", onClick: () => router.push("/settings/connections#tmdb") }
                        : { label: "Sign in to configure", onClick: requestSignIn },
                });
            } catch { /* A failed check must not interrupt Home. */ }
        }

        void check();
        return () => {
            active = false;
            window.removeEventListener(CONNECTION_CREDENTIALS_EVENT, onCredentials);
        };
    }, [authenticated, pathname, requestSignIn, router]);

    return null;
}
