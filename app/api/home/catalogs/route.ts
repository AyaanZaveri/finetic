import { getAuthData } from "@/lib/server/auth";
import { fetchCatalogItems } from "@/app/actions/media";
import type { HomeCatalogEntry, HomeCatalogSection } from "@/lib/home-catalogs";
import { NextResponse } from "next/server";

const MAX_BATCH_SIZE = 6;
const MAX_ITEMS_PER_SECTION = 12;

function isHomeCatalogEntry(value: unknown): value is HomeCatalogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<HomeCatalogEntry>;
  return (
    typeof entry.key === "string" &&
    typeof entry.sectionName === "string" &&
    typeof entry.catalogType === "string" &&
    typeof entry.catalogId === "string" &&
    typeof entry.addonTransportUrl === "string"
  );
}

async function loadCatalogSection(
  entry: HomeCatalogEntry,
  signal: AbortSignal
): Promise<HomeCatalogSection | null> {
  const items = await fetchCatalogItems(
    entry.catalogType,
    entry.catalogId,
    entry.addonTransportUrl,
    signal,
    MAX_ITEMS_PER_SECTION,
  );

  const mediaItems = items.slice(0, MAX_ITEMS_PER_SECTION);
  if (mediaItems.length === 0) return null;

  return {
    key: entry.key,
    sectionName: entry.sectionName,
    mediaItems,
  };
}

export async function POST(request: Request) {
  try { await getAuthData(); } catch { return new Response("Unauthorized", { status: 401 }); }
  try {
    const payload = (await request.json()) as { entries?: unknown };
    const entriesRaw = Array.isArray(payload.entries) ? payload.entries : [];
    const validatedEntries = entriesRaw.filter(isHomeCatalogEntry).slice(0, MAX_BATCH_SIZE);

    if (validatedEntries.length === 0) {
      return NextResponse.json({ sections: [] });
    }

    request.signal.throwIfAborted();
    if (request.headers.get("Accept")?.includes("application/x-ndjson")) {
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, controller.signal]);
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          const encoder = new TextEncoder();
          void Promise.all(validatedEntries.map(async entry => {
            let result;
            try { result = { status: "ready", section: await loadCatalogSection(entry, signal) }; }
            catch { result = { status: "error" }; }
            if (!signal.aborted && !closed) stream.enqueue(encoder.encode(JSON.stringify({ key: entry.key, result }) + "\n"));
          })).then(() => { if (!closed) { closed = true; stream.close(); } });
        },
        cancel() { closed = true; controller.abort(); },
      });
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store" } });
    }

    const loadedSections = await Promise.all(
      validatedEntries.map((entry) => loadCatalogSection(entry, request.signal))
    );

    return NextResponse.json({
      sections: loadedSections.filter(
        (section): section is HomeCatalogSection => section !== null
      ),
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("Failed to load home catalog batch:", error);
    return NextResponse.json(
      { error: "Failed to load home catalog batch" },
      { status: 500 }
    );
  }
}
