"use client";

import { useEffect, useState } from "react";
import { MediaSection } from "@/components/media-section";
import { AccountContext } from "@/contexts/account-context";
import type { MediaItem } from "@/types/stremio";

const imageUrl = (kind: string, id: string, extension: string) => `https://image.tmdb.org/t/p/w780/reveal-${kind}-${id}.${extension}`;
const items: MediaItem[] = ["a", "b", "c", "d"].map((id, index) => ({
    id: `tt900000${index}`, type: "movie", name: `Reveal fixture ${id}`, year: 2026,
    background: imageUrl("backdrop", id, "jpg"), logo: imageUrl("logo", id, "png"),
    progressPercent: 30,
}));

export default function ArtworkRevealFixture() {
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => setHydrated(true), []);
    const [mounted, setMounted] = useState(false);
    const [revision, setRevision] = useState(0);
    return <AccountContext.Provider value={{ authenticated: false, requestSignIn() {} }}>
        <main className="min-h-dvh p-8" data-artwork-fixture data-hydrated={hydrated || undefined}>
            <h1 className="mb-4 text-xl">Artwork reveal fixture</h1>
            <button data-mount-row type="button" onClick={() => setMounted(true)}>Mount cached row</button>
            <button data-refresh-row type="button" onClick={() => setRevision(n => n + 1)}>Refresh metadata</button>
            {mounted && <MediaSection sectionName="Continue Watching" continueWatching revealArtwork={false}
                mediaItems={items.map(item => ({ ...item, progressPercent: 30 + revision }))} />}
        </main>
    </AccountContext.Provider>;
}
