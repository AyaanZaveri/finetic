import { NextResponse } from "next/server";
import { getInstalledAddons } from "@/app/actions/auth";
import type { StremioAddon } from "@/types/stremio";
import { createHash } from "node:crypto";

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "movie";

    const addons = await getInstalledAddons();
    const streamAddons = addons
      .filter((addon) => addonSupportsStream(addon, type))
      .map((addon) => ({
        id: addon.manifest.id || addon.transportUrl,
        name: addon.manifest.name || "Unknown addon",
        logo: addon.manifest.logo,
        transportUrl: addon.transportUrl,
      }));

    const revision = createHash("sha256").update(JSON.stringify(addons.map(addon => [addon.transportUrl, addon.manifest]))).digest("hex");
    return NextResponse.json({ addons: streamAddons, revision }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    if (error?.message?.includes("Not authenticated")) {
      return NextResponse.json({ addons: [] }, { status: 401 });
    }
    console.error("Failed to list stream addons:", error);
    return NextResponse.json({ addons: [] }, { status: 500 });
  }
}
