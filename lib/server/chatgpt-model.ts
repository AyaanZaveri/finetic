import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, wrapLanguageModel } from "ai";
import { CHATGPT_PROVIDER_ID } from "@/lib/chatgpt-provider";
import { record } from "@/lib/navigator-chat";
import {
    CHATGPT_RESOURCE, chatGPTCredential, ChatGPTConnectionError, chatGPTServiceMessage, listChatGPTModels,
} from "./chatgpt-connection";

function streamFailure(event: Record<string, unknown>, status = 502) {
    const code = record(record(event.response).error).code ?? record(event.error).code ?? event.code;
    return new ChatGPTConnectionError(chatGPTServiceMessage(status, typeof code === "string" ? code : undefined), status);
}

export async function createChatGPTModel(userId: string, selection: unknown) {
    const credential = await chatGPTCredential(userId);
    const models = await listChatGPTModels(credential.accessToken);
    const modelId = selection || models[0]?.id;
    if (typeof modelId !== "string" || !models.some(model => model.id === modelId)) {
        throw new ChatGPTConnectionError("Choose an available ChatGPT model in Settings.");
    }
    const provider = createOpenAI({
        apiKey: "navigator-chatgpt",
        baseURL: CHATGPT_RESOURCE,
        fetch: Object.assign(async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
            if (String(url) !== `${CHATGPT_RESOURCE}/responses` || options?.method !== "POST") {
                throw new ChatGPTConnectionError("ChatGPT plan usage requires the Responses API.", 500);
            }
            const headers = new Headers(options.headers);
            const current = await chatGPTCredential(userId, credential.sessionId);
            headers.set("Authorization", `Bearer ${current.accessToken}`);
            const response = await fetch(url, { ...options, headers, redirect: "error", cache: "no-store" }).catch(error => {
                if (options.signal?.aborted) throw error;
                throw new ChatGPTConnectionError("The connection to ChatGPT was interrupted. Try again.", 502);
            });
            if (!response.ok) {
                const data = record(await response.json().catch(() => null));
                const code = record(data.error).code;
                throw new ChatGPTConnectionError(chatGPTServiceMessage(response.status, typeof code === "string" ? code : undefined), response.status);
            }
            return response;
        }, { preconnect: () => undefined }),
    });
    return wrapLanguageModel({
        model: provider.responses(modelId),
        providerId: CHATGPT_PROVIDER_ID,
        middleware: {
            specificationVersion: "v4",
            transformParams: async ({ params }) => ({
                ...params,
                maxOutputTokens: undefined,
                temperature: undefined,
                topP: undefined,
                topK: undefined,
                includeRawChunks: true,
                providerOptions: { openai: { store: false, systemMessageMode: "developer" } },
                tools: params.tools?.map(tool => tool.type === "function" ? {
                    ...tool,
                    providerOptions: { openai: { namespace: { name: "navigator", description: "Find and play media and look up subtitle evidence in Navigator." } } },
                } : tool),
            }),
            wrapGenerate: async () => {
                throw new ChatGPTConnectionError("ChatGPT plan responses must be streamed.", 500);
            },
            wrapStream: async ({ doStream }) => {
                const result = await Promise.resolve(doStream()).catch(error => {
                    if (APICallError.isInstance(error)) throw streamFailure(record(error.data), error.statusCode);
                    throw error;
                });
                let completed = false;
                let failure: ChatGPTConnectionError | undefined;
                return {
                    ...result,
                    stream: result.stream.pipeThrough(new TransformStream({
                        transform(part, controller) {
                            if (part.type === "raw") {
                                const event = record(part.rawValue);
                                completed ||= event.type === "response.completed";
                                if (event.type === "response.failed" || event.type === "error") {
                                    failure = streamFailure(event);
                                } else if (event.type === "response.incomplete") {
                                    failure = new ChatGPTConnectionError("ChatGPT returned an incomplete response. Try again.", 502);
                                }
                            } else if (part.type === "error" || (part.type === "finish" && (!completed || failure))) {
                                controller.error(failure ?? new ChatGPTConnectionError("The ChatGPT response ended before it completed. Try again.", 502));
                            } else {
                                controller.enqueue(part);
                            }
                        },
                    })),
                };
            },
        },
    });
}
