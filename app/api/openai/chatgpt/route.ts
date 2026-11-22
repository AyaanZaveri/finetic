import { z } from "zod";
import { getAuthData } from "@/lib/server/auth";
import {
    cancelChatGPTSignIn, chatGPTCredential, chatGPTAvailable, ChatGPTConnectionError, chatGPTStatus,
    listChatGPTModels, requireChatGPTOrigin, signOutChatGPT, startChatGPTSignIn,
} from "@/lib/server/chatgpt-connection";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("start") }),
    z.object({ action: z.literal("cancel"), attemptId: z.string().uuid() }),
    z.object({ action: z.literal("sign-out"), forget: z.boolean() }),
    z.object({ action: z.literal("models") }),
]);

function json(value: unknown, status = 200) {
    return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
    if (error instanceof ChatGPTConnectionError) return json({ error: error.message }, error.status);
    if (error instanceof Error && error.message === "Not authenticated") return json({ error: "Sign in to Navigator first." }, 401);
    return json({ error: "Navigator could not complete this ChatGPT request. Try again." }, 500);
}

export async function GET(request: Request) {
    if (!chatGPTAvailable(request)) return json({ available: false });
    try {
        const { user } = await getAuthData();
        return json(await chatGPTStatus(user._id, new URL(request.url).searchParams.get("attempt")));
    } catch (error) {
        return failure(error);
    }
}

export async function POST(request: Request) {
    try {
        requireChatGPTOrigin(request);
        const { user } = await getAuthData();
        const data = actionSchema.safeParse(await request.json().catch(() => null));
        if (!data.success) return json({ error: "Invalid ChatGPT request." }, 400);
        switch (data.data.action) {
        case "start":
            return json(await startChatGPTSignIn(user._id));
        case "cancel":
            await cancelChatGPTSignIn(user._id, data.data.attemptId);
            return json({ success: true });
        case "sign-out":
            return json({ revoked: await signOutChatGPT(user._id, data.data.forget) });
        case "models":
            return json({ models: await listChatGPTModels((await chatGPTCredential(user._id)).accessToken) });
        }
    } catch (error) {
        return failure(error);
    }
}
