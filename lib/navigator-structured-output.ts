import { generateText, streamText, Output, NoOutputGeneratedError, NoObjectGeneratedError } from "ai";
import type { Instructions, LanguageModel } from "ai";
import type { z } from "zod";
import { CHATGPT_PROVIDER_ID } from "@/lib/chatgpt-provider";

type Request = Parameters<typeof generateText>[0];
export type NavigatorObjectOptions<T> = Omit<Request, "output"> & { schema: z.ZodType<T>; task: string };

export class NavigatorStructuredOutputError extends Error {
    constructor(public readonly kind: "invalid-output" | "timeout", options?: ErrorOptions) {
        super(kind === "timeout" ? "The model exceeded the generation deadline." : "The model did not return a valid structured answer.", options);
        this.name = "NavigatorStructuredOutputError";
    }
}

const errorMessage = (error: unknown) => {
    const e = error as { message?: string; responseBody?: string };
    return `${e?.message ?? ""} ${e?.responseBody ?? ""}`.toLowerCase();
};
function isUnsupported(error: unknown) {
    const e = error as { statusCode?: number; status?: number };
    return [400, 422].includes(e?.statusCode ?? e?.status ?? 0) &&
        /(?:response[_ -]?format|json[_ -]?schema|structured).*(?:unsupported|not supported|not enabled|unavailable)|(?:unsupported|not supported|not enabled).*(?:response[_ -]?format|json[_ -]?schema|structured)/i.test(errorMessage(error));
}
function parseJson(text: string) {
    const value = text.trim();
    const fence = value.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    return JSON.parse(fence ? fence[1] : value);
}
function numericTimeout(timeout: unknown): number | undefined {
    if (typeof timeout === "number") return timeout;
    if (timeout && typeof timeout === "object" && typeof (timeout as { totalMs?: unknown }).totalMs === "number") return (timeout as { totalMs: number }).totalMs;
    return undefined;
}
function minimalUsage(usage: unknown) {
    if (!usage || typeof usage !== "object") return undefined;
    const u = usage as Record<string, unknown>;
    return Object.fromEntries(["inputTokens", "outputTokens", "totalTokens"].filter(k => typeof u[k] === "number").map(k => [k, u[k]]));
}

async function readStreamedResult(options: Request, textMode: boolean) {
    let streamError: unknown;
    const stream = streamText({ ...options, maxRetries: 0, onError: ({ error }) => { streamError = error; } });
    await stream.consumeStream({ onError: error => { streamError ??= error; } });
    if (streamError) throw streamError;
    return {
        text: await stream.text,
        output: textMode ? undefined : await stream.output,
        finishReason: await stream.finishReason,
        usage: await stream.usage,
        totalUsage: await stream.totalUsage,
    };
}

/** One deadline and at most one recovery/fallback attempt; output is always locally Zod-validated. */
export async function generateNavigatorObject<T>(options: NavigatorObjectOptions<T>) {
    const { schema, task, ...request } = options;
    const model = request.model as LanguageModel;
    const modelInfo = model && typeof model === "object" ? { provider: model.provider, modelId: model.modelId } : { provider: "", modelId: String(model ?? "") };
    const iceman = (modelInfo.provider === "opencode" || modelInfo.provider.startsWith("opencode.")) && modelInfo.modelId === "iceman-contributor-free";
    const totalMs = numericTimeout(request.timeout);
    const started = Date.now();
    const deadlineAt = totalMs === undefined ? undefined : started + totalMs;
    const controller = new AbortController();
    const outerSignal = request.abortSignal;
    const abort = () => controller.abort(outerSignal?.reason);
    if (outerSignal?.aborted) abort(); else outerSignal?.addEventListener("abort", abort, { once: true });
    const timer = deadlineAt === undefined ? undefined : setTimeout(() => controller.abort(new NavigatorStructuredOutputError("timeout")), Math.max(0, totalMs!));
    let attempts = 0;
    let mode = iceman ? "json-text" : "native";
    const call = async (textMode: boolean, recovery = false) => {
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error("Aborted");
        attempts++;
        const schemaInstruction = `Return only JSON matching this schema; do not include markdown or prose:\n${JSON.stringify(schema.toJSONSchema())}`;
        const original = request.instructions ?? request.system;
        const instructions: Instructions | undefined = textMode
            ? typeof original === "string" || original === undefined
                ? [original, schemaInstruction].filter(Boolean).join("\n\n")
                : [...(Array.isArray(original) ? original : [original]), { role: "system", content: schemaInstruction }]
            : original;
        const repair = "The previous attempt did not produce a complete schema-valid final answer. Return a concise complete JSON answer, not prose or reasoning.";
        const finalInstructions: Instructions | undefined = !recovery ? instructions
            : typeof instructions === "string" || instructions === undefined
                ? [instructions, repair].filter(Boolean).join("\n\n")
                : [...(Array.isArray(instructions) ? instructions : [instructions]), { role: "system", content: repair }];
        const { system: _system, ...rest } = request as Request & { system?: string };
        const opts = {
            ...rest,
            ...(finalInstructions ? { instructions: finalInstructions } : {}),
            abortSignal: controller.signal,
            // A recovery attempt must never start another provider retry loop.
            maxRetries: recovery || attempts > 1 ? 0 : Math.min(request.maxRetries ?? 0, 1),
            output: textMode ? undefined : Output.object({ schema }),
        } as Request;
        if (textMode) delete (opts as Record<string, unknown>).output;
        const result = modelInfo.provider === CHATGPT_PROVIDER_ID
            ? await readStreamedResult(opts, textMode)
            : await generateText(opts);
        // Log before reading the output getter: parsing can throw even though
        // the provider completed and consumed reasoning/output tokens.
        console.log("[navigator-structured-attempt]", { task, model: `${modelInfo.provider}/${modelInfo.modelId}`,
            attempt: attempts, mode: textMode ? "json-text" : "native", finishReason: result.finishReason,
            usage: minimalUsage(result.totalUsage ?? result.usage) });
        // Without Output.object the SDK's output getter returns TEXT, not an object.
        // Never validate that string as though the provider had supplied an object.
        const raw: unknown = textMode ? parseJson(result.text ?? "") : result.output;
        const output = raw !== undefined && raw !== null ? schema.parse(raw) : schema.parse(parseJson(result.text ?? ""));
        return { ...result, output };
    };
    try {
        let result;
        try { result = await call(iceman); }
        catch (error) {
            if (controller.signal.aborted || outerSignal?.aborted) throw error;
            if (!iceman && isUnsupported(error)) { mode = "json-text"; result = await call(true); }
            else if ((NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error) || error instanceof SyntaxError || (error as { name?: string })?.name === "ZodError") && attempts < 2) {
                // Change the failing protocol rather than blindly repeating native
                // structured generation; local validation remains mandatory.
                mode = "json-text";
                result = await call(true, true);
            }
            else throw error;
        }
        console.log("[navigator-structured-output]", { task, model: `${modelInfo.provider}/${modelInfo.modelId}`, durationMs: Date.now() - started, mode, finishReason: result.finishReason, usage: minimalUsage(result.totalUsage ?? result.usage), attempts });
        return result;
    } catch (error) {
        console.warn("[navigator-structured-output]", { task, model: `${modelInfo.provider}/${modelInfo.modelId}`, durationMs: Date.now() - started, mode, attempts, error: error instanceof Error ? error.name : "unknown" });
        if (outerSignal?.aborted) throw outerSignal.reason;
        if (controller.signal.aborted) throw controller.signal.reason;
        if (NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error) || error instanceof SyntaxError || (error as { name?: string })?.name === "ZodError") {
            throw new NavigatorStructuredOutputError("invalid-output", { cause: error });
        }
        throw error;
    } finally {
        if (timer !== undefined) clearTimeout(timer);
        outerSignal?.removeEventListener("abort", abort);
    }
}
