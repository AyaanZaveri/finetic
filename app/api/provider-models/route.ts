import { getAuthData } from "@/lib/server/auth";
import { isModelListProvider, listProviderModels } from "@/lib/server/provider-model-list";

export async function POST(req: Request) {
    const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    try { await getAuthData(); } catch { return respond({ error: "Unauthorized" }, 401); }
    const provider = new URL(req.url).searchParams.get("provider") ?? "";
    if (!isModelListProvider(provider)) return respond({ error: "Unknown model provider." }, 400);
    const apiKey = req.headers.get("x-provider-api-key")?.trim();
    if (!apiKey) return respond({ error: "Enter an API key to check model access." }, 400);

    const result = await listProviderModels(provider, apiKey, req.signal);
    if ("error" in result) return respond({ error: result.error }, result.status);
    return respond(result);
}
