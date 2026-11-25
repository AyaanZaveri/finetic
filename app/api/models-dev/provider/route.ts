import { NextResponse } from "next/server";
import {
  getModelsDevProviderById,
  matchModelsDevProvider,
} from "@/lib/models-dev";
import { loadModelsDevCatalog } from "@/lib/server/models-dev-catalog";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const baseUrl = searchParams.get("baseUrl")?.trim() ?? "";
  const providerId = searchParams.get("providerId")?.trim() ?? "";

  if (!baseUrl && !providerId) {
    return NextResponse.json(
      { error: "A baseUrl or providerId query parameter is required." },
      { status: 400 }
    );
  }

  try {
    const payload = await loadModelsDevCatalog();
    const provider = providerId
      ? getModelsDevProviderById(payload, providerId)
      : matchModelsDevProvider(payload, baseUrl);

    return NextResponse.json({ provider }, {
      headers: { "Cache-Control": provider ? "public, max-age=3600" : "no-store" },
    });
  } catch (error) {
    console.error("models.dev provider lookup failed:", error);
    return NextResponse.json(
      { error: "Unexpected error while looking up models.dev provider data." },
      { status: 500 }
    );
  }
}
