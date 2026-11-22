import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { OPENAI_DEFAULT_BASE_URL } from "@/lib/models-dev";

const unsupported = [
    "background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation", "multi_agent",
    "previous_response_id", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs",
    "top_p", "truncation", "user",
];

const terminalEvents = new Set(["response.completed", "response.incomplete", "response.failed", "error"]);

async function fetchChatGPTResponse(...[input, init]: Parameters<typeof fetch>) {
    if (String(input) !== `${OPENAI_DEFAULT_BASE_URL}/responses` || typeof init?.body !== "string") {
        throw new Error("Invalid ChatGPT Responses request.");
    }
    const body = JSON.parse(init.body);
    const sdkStreaming = body.stream === true;
    for (const key of unsupported) delete body[key];
    body.stream = true;
    body.store = false;
    if (Array.isArray(body.tools)) {
        const functions = body.tools.filter((tool: { type: string }) => tool.type === "function");
        const otherTools = body.tools.filter((tool: { type: string }) => tool.type !== "function");
        body.tools = functions.length ? [...otherTools, {
            type: "namespace", name: "navigator", description: "Navigator media tools", tools: functions,
        }] : otherTools;
    }
    const response = await fetch(input, { ...init, body: JSON.stringify(body), redirect: "error", cache: "no-store" });
    if (!response.ok || !response.body) return response;
    const events = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
    if (!sdkStreaming) {
        // The SDK's generateText expects a JSON response. OpenAI requires SSE
        // for ChatGPT plan usage, including these internal structured calls.
        const reader = events.getReader();
        try {
            for (;;) {
                const { done, value: event } = await reader.read();
                if (done || event.data === "[DONE]") break;
                const value = JSON.parse(event.data);
                if (!terminalEvents.has(value.type)) continue;
                if (value.response) return Response.json(value.response, { headers: responseHeaders(response, "application/json") });
                return Response.json({ error: { message: "ChatGPT couldn’t complete the request.", code: value.code } },
                    { status: 502, headers: responseHeaders(response, "application/json") });
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }
        throw new Error("ChatGPT closed the connection before completing the response.");
    }
    let terminal = false;
    const encoder = new TextEncoder();
    return new Response(events.pipeThrough(new TransformStream({
        transform(event, controller) {
            if (event.data === "[DONE]") return;
            if (terminalEvents.has(JSON.parse(event.data).type)) terminal = true;
            controller.enqueue(encoder.encode(event.data.split("\n").map(line => `data: ${line}\n`).join("") + "\n"));
        },
        flush(controller) {
            if (!terminal) controller.error(new Error("ChatGPT closed the connection before completing the response."));
        },
    })), { headers: responseHeaders(response, "text/event-stream") });
}

function responseHeaders(response: Response, contentType: string) {
    const headers = new Headers({ "Content-Type": contentType });
    const id = response.headers.get("x-request-id");
    if (id) headers.set("x-request-id", id);
    return headers;
}

export function createChatGPTModel(modelId: string, accessToken: string) {
    const model = createOpenAI({ apiKey: accessToken, baseURL: OPENAI_DEFAULT_BASE_URL, fetch: fetchChatGPTResponse }).responses(modelId);
    const doGenerate = model.doGenerate.bind(model);
    const doStream = model.doStream.bind(model);
    const buildOptions = (options: Parameters<typeof doStream>[0]) => ({
        ...options,
        providerOptions: {
            ...options.providerOptions,
            openai: { ...options.providerOptions?.openai, store: false, systemMessageMode: "developer" },
        },
    });
    model.doGenerate = options => doGenerate(buildOptions(options));
    model.doStream = options => doStream(buildOptions(options));
    return model;
}
