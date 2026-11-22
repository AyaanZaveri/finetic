import { z } from "zod";
import { getAuthData } from "@/lib/server/auth";
import {
    ChatGPTAuthError, chatGPTCredentials, chatGPTStatus, localChatGPTAvailable, startChatGPTSignIn, updateChatGPT,
} from "@/lib/server/chatgpt-auth";
import { OPENAI_DEFAULT_BASE_URL } from "@/lib/models-dev";

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const actionSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("signIn"), clientId: z.string().max(256).optional() }),
    z.object({ action: z.literal("update"), enabled: z.boolean().optional(), active: z.string().max(256).optional(),
        model: z.string().min(1).max(256).optional(), modelAccount: z.string().max(256).optional(), signOut: z.boolean().optional() }),
    z.object({ action: z.literal("models"), clientId: z.string().max(256) }),
]);

export async function GET(req: Request) {
    if (!localChatGPTAvailable(req)) return respond({ available: false });
    const auth = await getAuthData().catch(() => null);
    if (!auth) return respond({ error: "Unauthorized" }, 401);
    try { return respond(await chatGPTStatus(auth.user._id)); }
    catch { return respond({ error: "Couldn’t read the saved ChatGPT connection." }, 500); }
}

export async function POST(req: Request) {
    if (!localChatGPTAvailable(req) || !req.headers.has("origin")) return respond({ error: "ChatGPT sign-in is available in Navigator Desktop." }, 403);
    const auth = await getAuthData().catch(() => null);
    if (!auth) return respond({ error: "Unauthorized" }, 401);
    const action = actionSchema.safeParse(await req.json().catch(() => null));
    if (!action.success) return respond({ error: "Invalid ChatGPT settings request." }, 400);
    const user = auth.user._id;
    try {
        if (action.data.action === "signIn") {
            await startChatGPTSignIn(user, action.data.clientId);
            return respond(await chatGPTStatus(user));
        }
        if (action.data.action === "update") return respond(await updateChatGPT(user, action.data));
        const credentials = await chatGPTCredentials(user);
        if (!credentials || credentials.clientId !== action.data.clientId) return respond({ error: "The selected ChatGPT account changed." }, 409);
        const response = await fetch(`${OPENAI_DEFAULT_BASE_URL}/models`, {
            headers: { Authorization: `Bearer ${credentials.accessToken}` },
            cache: "no-store", redirect: "error", signal: AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) {
            await response.body?.cancel();
            return respond({ error: response.status === 401 || response.status === 403
                ? "ChatGPT refused model access. Check your plan or sign in again."
                : "Couldn’t load ChatGPT models. Try again." }, response.status);
        }
        const { models } = await response.json() as { models?: Array<{ visibility?: string; slug?: string; display_name?: string }> };
        if (!Array.isArray(models)) return respond({ error: "ChatGPT returned an invalid model list." }, 502);
        return respond({ models: models.flatMap(model =>
            model?.visibility === "list" && typeof model.slug === "string" && model.slug
                ? [{ id: model.slug, name: typeof model.display_name === "string" && model.display_name || model.slug }]
                : []) });
    } catch (error) {
        return error instanceof ChatGPTAuthError ? respond({ error: error.message }, error.status)
            : respond({ error: "Couldn’t connect to ChatGPT. Try again." }, 502);
    }
}
