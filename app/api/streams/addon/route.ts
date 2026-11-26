import { outboundFetch, OutboundRequestError } from "@/lib/server/outbound-fetch";
import { NextResponse } from "next/server";
import { getInstalledAddons } from "@/app/actions/auth";
import type { StremioAddon } from "@/types/stremio";
import { parseStreamResponse } from "@/lib/media/stream-schema";

class AddonRateLimitError extends Error {
  constructor(readonly retryAfter: string | null) { super("Add-on rate limited"); }
}

function addonSupportsStream(addon: StremioAddon, type?: string): boolean {
  return addon.manifest.resources.some((resource) => {
    if (typeof resource === "string") {
      return resource === "stream";
    }
    if (resource.name !== "stream") return false;
    if (!type) return true;
    if (!resource.types || resource.types.length === 0) return true;
    return resource.types.includes(type);
  });
}

async function fetchAddonStreams(
  transportUrl: string,
  mediaItemId: string,
  type: string,
  signal: AbortSignal
) {
  const base = transportUrl.replace(/\/manifest\.json$/, "");
  const response = await outboundFetch(`${base}/stream/${type}/${mediaItemId}.json`, {
    headers: {
      Referer: "https://web.stremio.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
    },
    cache: "no-store",
    signal,
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    await response.body?.cancel();
    throw new AddonRateLimitError(retryAfter);
  }
  if (!response.ok) {
    throw new Error("The stream provider could not complete this lookup.");
  }

  return parseStreamResponse(await response.json());
}

export async function GET(request: Request) {
  try {
    request.signal.throwIfAborted();
    const { searchParams } = new URL(request.url);
    const mediaItemId = searchParams.get("mediaItemId");
    const type = searchParams.get("type") ?? "movie";
    const addonId = searchParams.get("addonId");

    if (!mediaItemId || !addonId) {
      return NextResponse.json({ streams: [] }, { status: 400 });
    }

    const addons = await getInstalledAddons();
    const addon = addons.find(
      (candidate) => (candidate.manifest.id || candidate.transportUrl) === addonId
    );

    if (!addon || !addonSupportsStream(addon, type)) {
      return NextResponse.json({ streams: [] }, { status: 404 });
    }

    let sourceId = mediaItemId;
    if (/^tmdb:[1-9]\d*(?=:|$)/.test(sourceId) && (type === "movie" || type === "series")) {
      const { resolveAddonMediaId } = await import("@/lib/tmdb-discovery");
      sourceId = await resolveAddonMediaId(sourceId, type, request.signal);
    }
    request.signal.throwIfAborted();
    const streams = await fetchAddonStreams(addon.transportUrl, sourceId, type, request.signal);

    return NextResponse.json({
      streams: streams.map((stream) => ({
        ...stream,
        name: stream.name || addon.manifest.name || "Unknown source",
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    // The client has gone away; stop owned I/O without logging an upstream fault.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof AddonRateLimitError) {
      return NextResponse.json({ streams: [], error: "This add-on is rate limited. Wait before trying again." }, {
        status: 429, headers: { "Cache-Control": "private, no-store", ...(error.retryAfter ? { "Retry-After": error.retryAfter } : {}) },
      });
    }
    if (error?.message?.includes("Not authenticated")) {
      return NextResponse.json({ streams: [] }, { status: 401 });
    }
    if (error instanceof OutboundRequestError) {
      // A configured provider rejected by the outbound policy is not an app
      // crash. Keep its URL/credentials and exception stack out of shared logs.
      return NextResponse.json({ streams: [], error: "This add-on cannot be used by this server." }, {
        status: 422, headers: { "Cache-Control": "private, no-store" },
      });
    }
    console.error("Failed to fetch addon streams:", error);
    return NextResponse.json({ streams: [] }, { status: 500 });
  }
}
