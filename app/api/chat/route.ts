import { subtitleSnapshotSchema } from "@/lib/media/subtitle-snapshot";
import { publicArtworkUrl } from "@/lib/artwork";
import { providerFetch, outboundUrl, outboundFetch, OutboundRequestError } from "@/lib/server/outbound-fetch";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
    createOpenRouter,
    type OpenRouterSharedSettings,
} from "@openrouter/ai-sdk-provider";
import { createGroq } from "@ai-sdk/groq";
import { createCerebras } from "@ai-sdk/cerebras";
import { createOllama } from "ai-sdk-ollama";
import { APICallError, NoObjectGeneratedError, RetryError, convertToModelMessages, streamText, isStepCount, validateUIMessages, toUIMessageStream, createUIMessageStreamResponse, createUIMessageStream } from "ai";
import { z } from "zod";
import { actionToolNames, record, compactNavigatorMessages, pageTargetFromPath } from "@/lib/navigator-chat";
import { navigatorRoutingSettings } from "@/lib/navigator-model-settings";
import { sceneRequestContext } from "@/lib/navigator-scene-context";
import { NavigatorStructuredOutputError } from "@/lib/navigator-structured-output";
import { navigatorToolPolicy } from "@/lib/navigator-tool-policy";
import { needsTextToolLoop, runTextToolLoop } from "@/app/tools/text-tool-loop";
import type { SceneProgress } from "@/lib/navigator-scene-progress";
import type { EpisodeProgress } from "@/lib/episode-discovery";
import { createOpenCodeGoModel } from "@/lib/opencode-go";
import { getTMDBPageContext } from "@/lib/tmdb-discovery";
import { createAllTools, createSystemPrompt } from "@/app/tools";
import { OPENAI_DEFAULT_BASE_URL } from "@/lib/models-dev";
import { ChatGPTConnectionError, requireChatGPTOrigin } from "@/lib/server/chatgpt-connection";
import { createChatGPTModel } from "@/lib/server/chatgpt-model";
import { getAuthData } from "@/lib/server/auth";

type OpenRouterReasoningEffort =
  | "default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
type CerebrasReasoningEffort = "default" | "low" | "medium" | "high";

const contextSchema = z.object({
    // Invalid/oversized or old snapshots fall back to normal authenticated discovery.
    currentSubtitles: z.preprocess(value => {
        const parsed = subtitleSnapshotSchema.safeParse(value);
        return parsed.success ? parsed.data : undefined;
    }, subtitleSnapshotSchema.optional()),
    pathname: z.string().max(2000).optional(),
    currentTimestamp: z.number().finite().nonnegative().optional(),
    currentMedia: z.object({
        id: z.string(), name: z.string(), type: z.enum(["movie", "series", "channel", "tv"]),
        mediaSourceId: z.string().optional(), seriesId: z.string().optional(),
        showName: z.string().optional(), episodeTitle: z.string().optional(),
        seasonNumber: z.number().optional(), episodeNumber: z.number().optional(),
        subtitleFilename: z.string().optional(), subtitleVideoSize: z.number().optional(),
        poster: z.string().optional().transform(publicArtworkUrl),
        thumbnail: z.string().optional().transform(publicArtworkUrl),
        backdropUrl: z.string().optional().transform(publicArtworkUrl),
    }).nullish(),
});

function chatError(error: unknown): { status: number; message: string } {
    if (error instanceof ChatGPTConnectionError) return { status: error.status, message: error.message };
    if (error instanceof OutboundRequestError) return { status: 400, message: error.message };
    if (error instanceof NavigatorStructuredOutputError) return { status: 502, message: error.kind === "timeout"
        ? "The analysis model took too long to finish. Try again or choose a faster model in Settings."
        : "The model could not produce a valid final answer. Try again or choose another model in Settings." };
    if (RetryError.isInstance(error) && error.errors.length) return chatError(error.errors.at(-1));
    if (error instanceof z.ZodError || error instanceof SyntaxError) return { status: 400, message: "This request could not be read. Start a new chat and try again." };
    if (NoObjectGeneratedError.isInstance(error)) return { status: 502, message: "The AI endpoint returned an invalid structured response. Check its JSON Schema support or choose another model." };
    if (APICallError.isInstance(error)) {
        let detail: Record<string, any> = {};
        try { detail = record(record(JSON.parse(error.responseBody || "{}")).error); } catch { /* Some providers return plain text. */ }
        if (detail.code === "api_key_expired") return { status: 400, message: "Your AI provider API key has expired. Replace it in Settings." };
        if (error.statusCode === 401 || error.statusCode === 403) return { status: 400, message: "Your AI provider rejected the API key. Check it in Settings." };
        if (error.statusCode === 429) return { status: 429, message: "Your AI provider is rate limiting requests or has no remaining credits. Wait a moment or check your provider account." };
        if ((error.statusCode === 400 || error.statusCode === 422) && /tool[_ -]?choice|tool.?call|function.?call/i.test(`${error.message} ${detail.message || ""}`)) {
            return { status: 400, message: "This model couldn’t run that action. Try again or choose another model in Settings." };
        }
        return { status: 502, message: "Your AI provider could not complete the request. Try again or choose another model in Settings." };
    }
    if (error instanceof Error && /API key is required|requires a stable session|Unsupported AI provider/.test(error.message)) return { status: 400, message: error.message };
    return { status: 500, message: "Navigator could not complete this request. Please try again." };
}

export async function POST(req: Request) {
    let usingChatGPT = false;
    try {
        const { user } = await getAuthData();

        const requestPayload = await req.json();
        const context = contextSchema.parse(requestPayload);
        const {
            messages,

            aiProvider = "openai",
            openaiBaseUrl = "https://api.openai.com/v1",
            openaiModel = "gpt-4o-mini",
            openaiAuthMethod,
            chatGPTModel,
            geminiModel = "gemini-flash-lite-latest",
            ollamaBaseUrl = "http://localhost:11434",
            ollamaModel = "phi3",
            ollamaApiKey,
            groqModel = "llama3-8b-8192",
            openrouterModel = "qwen/qwen3-coder:free",
            openrouterReasoningEffort = "default",
            cerebrasModel = "gpt-oss-120b",
            cerebrasReasoningEffort = "default",
            opencodeModel = "gpt-5.6-luna",
            openaiApiKey,
            googleApiKey,
            groqApiKey,
            openrouterApiKey,
            cerebrasApiKey,
            opencodeApiKey,
            opencodeSessionId,
        } = requestPayload;
        const { currentMedia, currentTimestamp, pathname } = context;
        usingChatGPT = aiProvider === "openai" && openaiAuthMethod === "chatgpt";
        if (usingChatGPT) requireChatGPTOrigin(req);
        if (aiProvider === "openai" && !usingChatGPT) outboundUrl(openaiBaseUrl, { provider: true });
        if (aiProvider === "ollama") outboundUrl(ollamaBaseUrl, { provider: true });
        if (aiProvider === "openai" && !usingChatGPT && openaiBaseUrl !== OPENAI_DEFAULT_BASE_URL && !openaiApiKey) {
            return new Response("A custom AI endpoint requires its own API key in Settings.", { status: 400 });
        }

        if (!Array.isArray(messages)) {
            return new Response("Invalid messages payload", { status: 400 });
        }

        const normalizedOpenrouterReasoningEffort: OpenRouterReasoningEffort =
      openrouterReasoningEffort === "none" ||
      openrouterReasoningEffort === "minimal" ||
      openrouterReasoningEffort === "low" ||
      openrouterReasoningEffort === "medium" ||
      openrouterReasoningEffort === "high" ||
      openrouterReasoningEffort === "xhigh"
          ? openrouterReasoningEffort
          : "default";

        const normalizedCerebrasReasoningEffort: CerebrasReasoningEffort =
      cerebrasReasoningEffort === "low" ||
      cerebrasReasoningEffort === "medium" ||
      cerebrasReasoningEffort === "high"
          ? cerebrasReasoningEffort
          : "default";

        console.log({
            aiProvider,
            openaiModel,
            geminiModel,
            ollamaModel,
            groqModel,
            openrouterModel,
            openrouterReasoningEffort: normalizedOpenrouterReasoningEffort,
            cerebrasModel,
            cerebrasReasoningEffort: normalizedCerebrasReasoningEffort,
            opencodeModel,
            hasOpenaiApiKey: Boolean(openaiApiKey),
            hasGoogleApiKey: Boolean(googleApiKey),
            hasGroqApiKey: Boolean(groqApiKey),
            hasOpenrouterApiKey: Boolean(openrouterApiKey),
            hasCerebrasApiKey: Boolean(cerebrasApiKey),
            hasOpencodeApiKey: Boolean(opencodeApiKey),
            hasOpencodeSessionId: Boolean(opencodeSessionId),
        });

        const openrouterModelSettings: OpenRouterSharedSettings | undefined =
      normalizedOpenrouterReasoningEffort === "default"
          ? undefined
          : {
              // Use extraBody so we can forward all OpenRouter API-supported values.
              extraBody: {
                  reasoning: {
                      effort: normalizedOpenrouterReasoningEffort,
                  },
              },
          };

        const selectModel = () => {
            let model;
            switch (aiProvider) {
            case "openai":
                if (openaiApiKey) {
                    if (openaiBaseUrl === OPENAI_DEFAULT_BASE_URL) {
                        const openaiProvider = createOpenAI({
                            apiKey: openaiApiKey, fetch: providerFetch,
                            baseURL: openaiBaseUrl,
                        });
                        model = openaiProvider(openaiModel);
                    } else {
                        const openaiCompatibleProvider = createOpenAICompatible({
                            name: "openai-compatible",
                            supportsStructuredOutputs: true,
                            apiKey: openaiApiKey, fetch: providerFetch,
                            baseURL: openaiBaseUrl,
                        });
                        model = openaiCompatibleProvider(openaiModel);
                    }
                } else if (process.env.OPENAI_API_KEY) {
                    model = createOpenAI({ apiKey: process.env.OPENAI_API_KEY, fetch: providerFetch })(openaiModel);
                } else {
                    throw new Error(
                        "OpenAI API key is required for OpenAI provider. Please set your API key in settings."
                    );
                }
                break;
            case "gemini":
                if (googleApiKey) {
                    const googleProvider = createGoogle({
                        apiKey: googleApiKey, fetch: providerFetch,
                    });
                    model = googleProvider(geminiModel);
                } else if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
                    // Fallback to environment variable
                    model = createGoogle({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY, fetch: providerFetch })(geminiModel);
                } else {
                    throw new Error(
                        "Google API key is required for Gemini provider. Please set your API key in settings."
                    );
                }
                break;
            case "ollama": {
                const ollamaProvider = createOllama({
                    baseURL: ollamaBaseUrl, fetch: providerFetch,
                    headers: ollamaApiKey?.trim() ? { Authorization: `Bearer ${ollamaApiKey.trim()}` } : undefined,
                });
                model = ollamaProvider(ollamaModel);
                break;
            }
            case "groq":
                if (groqApiKey) {
                    const groqProvider = createGroq({
                        apiKey: groqApiKey, fetch: providerFetch,
                    });
                    model = groqProvider(groqModel);
                } else if (process.env.GROQ_API_KEY) {
                    model = createGroq({ apiKey: process.env.GROQ_API_KEY, fetch: providerFetch })(groqModel);
                } else {
                    throw new Error(
                        "Groq API key is required for Groq provider. Please set your API key in settings."
                    );
                }
                break;
            case "openrouter":
                if (openrouterApiKey) {
                    const openrouterProvider = createOpenRouter({
                        apiKey: openrouterApiKey, fetch: providerFetch,
                    });
                    model = openrouterProvider(openrouterModel, openrouterModelSettings);
                } else if (process.env.OPENROUTER_API_KEY) {
                    model = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, fetch: providerFetch })(openrouterModel, openrouterModelSettings);
                } else {
                    throw new Error(
                        "OpenRouter API key is required for OpenRouter provider. Please set your API key in settings."
                    );
                }
                break;
            case "cerebras":
                if (cerebrasApiKey) {
                    const cerebrasProvider = createCerebras({
                        apiKey: cerebrasApiKey, fetch: providerFetch,
                    });
                    model = cerebrasProvider(cerebrasModel);
                } else if (process.env.CEREBRAS_API_KEY) {
                    model = createCerebras({ apiKey: process.env.CEREBRAS_API_KEY, fetch: providerFetch })(cerebrasModel);
                } else {
                    throw new Error(
                        "Cerebras API key is required for Cerebras provider. Please set your API key in settings."
                    );
                }
                break;
            case "opencode": {
                const apiKey = opencodeApiKey || process.env.OPENCODE_GO_API_KEY;
                if (!apiKey) {
                    throw new Error(
                        "OpenCode Go API key is required. Please set your API key in settings."
                    );
                }
                if (typeof opencodeSessionId !== "string" || !opencodeSessionId.trim()) {
                    throw new Error("OpenCode Go requires a stable session ID.");
                }
                model = createOpenCodeGoModel(opencodeModel, apiKey, opencodeSessionId);
                break;
            }
            default:
                throw new Error(`Unsupported AI provider: ${aiProvider}`);
            }

            return model;
        };
        const model = usingChatGPT ? await createChatGPTModel(user._id, chatGPTModel) : selectModel();

        let tools = createAllTools(currentMedia, currentTimestamp, model, req.signal, undefined, [], context.currentSubtitles);
        let validatedMessages;
        try {
            validatedMessages = await validateUIMessages({ messages, tools });
        } catch {
            return new Response("This conversation contains an incomplete or outdated tool result. Start a new chat to continue.", { status: 400 });
        }
        if (validatedMessages.some(message => message.role === "system")) {
            return new Response("Invalid message role", { status: 400 });
        }
        // Bind validated, uncompacted user context outside the model-controlled tool schema.
        tools = createAllTools(currentMedia, currentTimestamp, model, req.signal, sceneRequestContext(validatedMessages), validatedMessages.filter(message => message.role === "assistant").flatMap(message => message.parts), context.currentSubtitles);
        // Retain the old handoff schema for saved chats, without advertising it to models.
        const { completeAction: _legacyAction, findEpisodeByTitle: _legacyEpisodes, ...generationTools } = tools;
        const compactedMessages = compactNavigatorMessages(validatedMessages);
        const modelMessages = await convertToModelMessages(compactedMessages, { tools, ignoreIncompleteToolCalls: true });
        const pageTarget = pathname ? pageTargetFromPath(pathname) : null;
        let pageContext = null;
        if (pageTarget) {
            try {
                pageContext = await getTMDBPageContext(pageTarget, req.signal);
            } catch (error) {
                req.signal.throwIfAborted();
                pageContext = { ...pageTarget, metadataUnavailable: error instanceof Error ? error.message : "TMDB metadata unavailable." };
            }
        }
        req.signal.throwIfAborted();
        const systemPrompt = createSystemPrompt(currentMedia, currentTimestamp, pageContext);
        const toolPolicy = navigatorToolPolicy(validatedMessages);
        const startedAt = Date.now();

        const streamSettings: {
      temperature?: number;
      maxOutputTokens: number;
      maxRetries: number;
      providerOptions?: any;
    } = {
        maxOutputTokens: 1400,
        maxRetries: usingChatGPT ? 0 : 2,
        ...navigatorRoutingSettings(model, "minimal", "tools"),
    };

        if (aiProvider === "cerebras") {
            const cerebrasProviderOptions: Record<string, any> = {};
            if (normalizedCerebrasReasoningEffort !== "default") {
                cerebrasProviderOptions.reasoningEffort =
          normalizedCerebrasReasoningEffort;
            }
            if (Object.keys(cerebrasProviderOptions).length > 0) {
                streamSettings.providerOptions = {
                    cerebras: cerebrasProviderOptions,
                };
            }
        }

        return createUIMessageStreamResponse({ stream: createUIMessageStream({
            originalMessages: validatedMessages,
            onError: error => chatError(error).message,
            execute: async ({ writer }) => {
                const progressTools: typeof generationTools = { ...generationTools, skipToSubtitleContent: {
                    ...generationTools.skipToSubtitleContent,
                    execute: async (input: unknown, options: Parameters<NonNullable<typeof generationTools.skipToSubtitleContent.execute>>[1]) => {
                        let latest: SceneProgress | undefined;
                        const onSceneProgress = (progress: SceneProgress) => {
                            latest = progress;
                            writer.write({ type: "data-sceneProgress", id: `${options.toolCallId}-${progress.stage}`, data: { ...progress, toolCallId: options.toolCallId } });
                        };
                        const output = await generationTools.skipToSubtitleContent.execute!(input, { ...options, context: { ...record(options.context), onSceneProgress } });
                        if (record(output).success === false && latest?.state === "running") onSceneProgress({ ...latest, state: "error", detail: record(output).error });
                        return output;
                    },
                } };
                for (const name of ["findEpisode", "findEpisodeByTitle", "getEpisodeCatalog", "verifyEpisode", "navigateToEpisode", "playMedia", "searchMediaWeb", "readMediaWebSources", "skipToSubtitleContent"]) {
                    const definition = progressTools[name];
                    if (!definition?.execute) continue;
                    progressTools[name] = { ...definition, execute: async (input, options) => {
                        let latest: EpisodeProgress | undefined;
                        const onEpisodeProgress = (progress: EpisodeProgress) => {
                            latest = progress;
                            writer.write({ type: "data-episodeProgress", id: `${options.toolCallId}-${progress.stage}`, data: { ...progress, toolCallId: options.toolCallId } });
                        };
                        const output = await definition.execute!(input, { ...options, context: { ...record(options.context), onEpisodeProgress } });
                        if (record(output).success === false && latest?.state === "running") onEpisodeProgress({ ...latest, state: "error", detail: record(output).error });
                        return output;
                    } };
                }
                // A model can emit several action calls in one native step. Reserve
                // preparation synchronously so parallel dispatch cannot launch twice.
                let actionReserved = toolPolicy.actionHandled;
                for (const name of actionToolNames) {
                    const definition = progressTools[name];
                    if (!definition?.execute) continue;
                    progressTools[name] = { ...definition, execute: async (input, options) => {
                        if (actionReserved) return { success: false, error: "An action has already been prepared or handled for this turn. Do not repeat it." };
                        actionReserved = true;
                        try {
                            const output = await definition.execute!(input, options);
                            if (record(output).execution !== "prepared") actionReserved = false;
                            return output;
                        } catch (error) {
                            actionReserved = false;
                            throw error;
                        }
                    } };
                }
                const stepPolicy = () => {
                    const activeTools = Object.keys(generationTools).filter(name =>
                        (currentMedia || !["explainScene", "analyzeMedia"].includes(name))
                        && (!actionReserved || !actionToolNames.has(name)));
                    return { activeTools, toolChoice: "auto" as const };
                };
                if (needsTextToolLoop(model)) {
                    await runTextToolLoop({ model, messages: modelMessages, tools: progressTools, instructions: systemPrompt,
                        signal: req.signal, writer, policy: stepPolicy });
                    return;
                }
                const result = streamText({
            experimental_download: async files => Promise.all(files.map(async ({ url }) => {
                const response = await outboundFetch(url, { signal: req.signal }, { maxBytes: 2 * 1024 * 1024 });
                if (!response.ok) throw new Error("The attached file could not be downloaded.");
                return { data: new Uint8Array(await response.arrayBuffer()), mediaType: response.headers.get("Content-Type") || undefined };
            })),
            model,
            messages: modelMessages,
            stopWhen: [isStepCount(12), ({ steps }) => steps.at(-1)?.toolResults.some(result =>
                actionToolNames.has(result.toolName) && (record(result.output).execution === "prepared"
                    || ((result.toolName === "skipToSubtitleContent" || ["not_found", "ambiguous", "unavailable"].includes(String(record(result.output).status))) && record(result.output).success === false))) ?? false],
            abortSignal: req.signal,
            timeout: { totalMs: 120_000, stepMs: 60_000 },
            ...streamSettings,
            tools: progressTools,
            instructions: systemPrompt,
            prepareStep: () => stepPolicy(),
            onStepEnd: (stepResult) => {
                console.log("[chat] step-finish", {
                    finishReason: stepResult.finishReason,
                    inputTokens: stepResult.usage?.inputTokens,
                    outputTokens: stepResult.usage?.outputTokens,
                    toolCalls: stepResult.toolCalls?.length ?? 0,
                });
            },
            onToolExecutionEnd: ({ toolCall, toolExecutionMs }) => {
                console.log("[chat] tool-end", { tool: toolCall.toolName, durationMs: toolExecutionMs });
            },
            onEnd: ({ totalUsage: usage, finishReason }) => {
                console.log("[chat] finish", {
                    finishReason,
                    durationMs: Date.now() - startedAt,
                    inputTokens: usage?.inputTokens,
                    outputTokens: usage?.outputTokens,
                    totalTokens: usage?.totalTokens,
                });
            },
            onError: ({ error }) => {
                if (usingChatGPT) console.error("[chat] ChatGPT stream error", chatError(error).message);
                else console.error("[chat] stream error", error);
            },
        });

                writer.merge(toUIMessageStream({
                stream: result.stream,
                originalMessages: validatedMessages,
                onError: error => chatError(error).message,
                }));
            },
        }) });
    } catch (error) {
        if (usingChatGPT) console.error("[chat] ChatGPT request error", chatError(error).message);
        else console.error("Chat API Error:", error);

        if (error instanceof Error && error.message === "Not authenticated") {
            return new Response("Unauthorized", { status: 401 });
        }

        const failure = chatError(error);
        return new Response(failure.message, { status: failure.status });
    }
}
