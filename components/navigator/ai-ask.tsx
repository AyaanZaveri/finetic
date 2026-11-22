"use client";

import { useChat } from "@ai-sdk/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useStore } from "jotai";
import { toast } from "sonner";
import { useRouter, usePathname } from "next/navigation";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { preparedNavigatorActions, shouldContinueAfterNavigatorAction, record, markNavigatorRequestStopped, pageTargetFromPath } from "@/lib/navigator-chat";
import { acknowledgePlayback, type ActionOutcome } from "@/lib/navigator-playback-ack";
import { useStreamQueries } from "@/components/stream-query-provider";
import type { SubtitleSnapshot } from "@/lib/media/subtitle-snapshot";
import { useMediaPlayer } from "@/contexts/MediaPlayerContext";
import { useTheme } from "next-themes";
import { isAIAskOpenAtom, currentTimestampAtom } from "@/lib/atoms";
import { useSettings } from "@/contexts/settings-context";
import { NavigatorFocus } from "./focus";
import { preloadPlayer } from "@/lib/preload-tools";
import { desktopBridge } from "@/lib/desktop/bridge";
import { isNavigatorRequestSettled, navigatorResponseDurations } from "@/lib/navigator-timing";
import { publicArtworkUrl } from "@/lib/artwork";

const AIAsk = ({ userId }: { userId: string }) => {
    const playbackStore = useStore();
    const subtitleQueries = useStreamQueries()?.subtitles;
    const subtitleSnapshotRef = useRef<Promise<SubtitleSnapshot | undefined> | undefined>(undefined);
    const [isAskOpen, setIsAskOpen] = useAtom(isAIAskOpenAtom);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [input, setInput] = useState("");
    const [isApplyingAction, setIsApplyingAction] = useState(false);
    const [requestDurationsMs, setRequestDurationsMs] = useState<
    Record<string, number>
  >({});
    const actionResultsRef = useRef(new Map<string, Promise<ActionOutcome>>());
    const actionAbortRef = useRef(new AbortController());
    const requestBodyRef = useRef<Record<string, unknown>>({});
    const continuationCountRef = useRef(0);
    const historyKey = userId ? `navigator-chat-v2:${userId}` : null;
    const pathname = usePathname();
    const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat", body: async () => {
        const body = requestBodyRef.current;
        const currentSubtitles = await subtitleSnapshotRef.current?.catch(() => undefined);
        return { ...body, currentSubtitles };
    } }), []);
    const taskStartTimeRef = useRef<number | null>(null);
    const playbackHandoffTimeRef = useRef<number | null>(null);
    const activeTaskUserMessageIdRef = useRef<string | null>(null);
    const awaitingTaskUserMessageRef = useRef(false);
    const messagesRef = useRef<UIMessage[]>([]);
    const opencodeSessionIdRef = useRef<string | null>(null);
    const {
        aiProvider,
        openaiBaseUrl,
        openaiModel,
        openaiAuthMethod,
        chatGPTModel,
        geminiModel,
        ollamaApiKey,
        ollamaBaseUrl,
        ollamaModel,
        groqModel,
        openrouterModel,
        openrouterReasoningEffort,
        cerebrasModel,
        cerebrasReasoningEffort,
        opencodeModel,
        openaiApiKey,
        googleApiKey,
        groqApiKey,
        openrouterApiKey,
        cerebrasApiKey,
        opencodeApiKey,
    } = useSettings();

    const getStableMessageId = (message: any, fallbackIndex: number) =>
        String(
            message?.id ||
        message?.message?.id ||
        `${message?.role || "msg"}-${fallbackIndex}`,
        );

    const finalizeRequestDuration = (completed = true, taskMessages = messagesRef.current) => {
        if (taskStartTimeRef.current == null) return;
        if (!completed) {
            taskStartTimeRef.current = null;
            return;
        }

        // Playback loading and the confirmation reply do not measure Navigator's work.
        const durationMs = Math.max(0, (playbackHandoffTimeRef.current ?? Date.now()) - taskStartTimeRef.current);
        const userIndex = taskMessages.findLastIndex(message => message.role === "user");
        const userMessageId = activeTaskUserMessageIdRef.current
            || (userIndex >= 0 ? getStableMessageId(taskMessages[userIndex], userIndex) : null);
        setRequestDurationsMs((prev) => {
            if (!userMessageId) return prev;
            return {
                ...prev,
                [userMessageId]: durationMs,
            };
        });

        taskStartTimeRef.current = null;
    };

    // Function to handle opening AI Ask, with fullscreen exit if needed
    const handleOpenAsk = async () => {
        if (isFullscreen && !desktopBridge()) {
            // Exit fullscreen first
            try {
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if ((document as any).webkitExitFullscreen) {
                    await (document as any).webkitExitFullscreen();
                } else if ((document as any).mozCancelFullScreen) {
                    await (document as any).mozCancelFullScreen();
                } else if ((document as any).msExitFullscreen) {
                    await (document as any).msExitFullscreen();
                }
                // Wait a bit for fullscreen to exit, then open AI Ask
                setTimeout(() => {
                    setIsAskOpen(true);
                }, 100);
            } catch (error) {
                console.warn("Failed to exit fullscreen:", error);
                // Still try to open AI Ask even if fullscreen exit fails
                setIsAskOpen(true);
            }
        } else {
            setIsAskOpen(!isAskOpen);
        }
    };

    const router = useRouter();
    const { setTheme, resolvedTheme } = useTheme();

    // Track fullscreen state
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);
        document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
        document.addEventListener("mozfullscreenchange", handleFullscreenChange);
        document.addEventListener("MSFullscreenChange", handleFullscreenChange);

        // Set initial state
        setIsFullscreen(!!document.fullscreenElement);

        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
            document.removeEventListener(
                "webkitfullscreenchange",
                handleFullscreenChange,
            );
            document.removeEventListener(
                "mozfullscreenchange",
                handleFullscreenChange,
            );
            document.removeEventListener(
                "MSFullscreenChange",
                handleFullscreenChange,
            );
        };
    }, []);

    const {
        playMedia,
        isPlayerVisible,
        skipToTimestamp,
        currentMediaWithSource,
    } = useMediaPlayer();

    const {
        messages,
        sendMessage,
        stop,
        status,
        error: askError,
        setMessages,
        clearError,
        addToolOutput,
    } = useChat({
        throttle: 50,
        onToolCall: ({ toolCall }) => {
            if (toolCall.toolName === "playMedia" || toolCall.toolName === "skipToSubtitleContent") preloadPlayer();
        },
        transport,
        sendAutomaticallyWhen: ({ messages: nextMessages }) => {
            return !actionAbortRef.current.signal.aborted && continuationCountRef.current < 8
                && shouldContinueAfterNavigatorAction(nextMessages)
                && lastAssistantMessageIsCompleteWithToolCalls({ messages: nextMessages });
        },
        onFinish: ({ messages: nextMessages, isAbort, isError }) => {
            if (!isAbort && !isError) {
                const actions = preparedNavigatorActions(nextMessages);
                if (actions.length) {
                    const signal = actionAbortRef.current.signal;
                    setIsApplyingAction(true);
                    // Let the SDK close its request before updating tool output and continuing.
                    setTimeout(() => { void applyPreparedActions(actions, signal); }, 0);
                    return;
                }
                if (shouldContinueAfterNavigatorAction(nextMessages)
                    && lastAssistantMessageIsCompleteWithToolCalls({ messages: nextMessages }) && continuationCountRef.current < 8) return;
            }
            finalizeRequestDuration(!isAbort && !isError && isNavigatorRequestSettled(nextMessages), nextMessages);
            activeTaskUserMessageIdRef.current = null;
            awaitingTaskUserMessageRef.current = false;
        },
        onError: () => {
            finalizeRequestDuration(false);
            activeTaskUserMessageIdRef.current = null;
            awaitingTaskUserMessageRef.current = false;
        },
    });

    async function applyPreparedActions(actions: ReturnType<typeof preparedNavigatorActions>, signal: AbortSignal) {
        try {
            for (const action of actions) {
                if (signal.aborted) return;
                continuationCountRef.current += 1;
                let task = actionResultsRef.current.get(action.toolCallId);
                if (!task) {
                    task = executePreparedAction(action.toolCallId, action.output, signal);
                    actionResultsRef.current.set(action.toolCallId, task);
                }
                const result = await task;
                if (signal.aborted) return;
                // Updating the original tool result gives the model the actual browser outcome.
                void addToolOutput({ tool: action.toolName, toolCallId: action.toolCallId,
                    output: { ...action.output, ...result, execution: "completed" } });
                if (!result.success && result.status !== "cancelled") {
                    setIsAskOpen(true);
                    toast.error(result.message);
                }
            }
        } finally { setIsApplyingAction(false); }
    }

    async function executePreparedAction(preparedToolCallId: string, output: unknown, signal: AbortSignal): Promise<ActionOutcome> {
        if (signal.aborted) return { success: false, status: "cancelled", message: "Action cancelled." };
        const action = record(output);
        try {
            switch (action.action) {
            case "navigate": {
                const url = action.url;
                if (typeof url !== "string") throw new Error("Invalid navigation destination.");
                const person = pageTargetFromPath(url)?.type === "person";
                if (!person && !/^\/(movie|series)\/[^?#]+$/.test(url)) throw new Error("Invalid navigation destination.");
                router.push(url);
                setIsAskOpen(false);
                return { success: true, status: "requested", message: person ? "Navigation to the selected profile was requested." : "Navigation to the selected title was requested." };
            }
            case "play": {
                if (!action.mediaId || !action.mediaName || !["Movie", "Series", "Episode"].includes(action.mediaType)) throw new Error("Missing playback details.");
                const isEpisode = action.mediaType === "Episode";
                playbackHandoffTimeRef.current = Date.now();
                return await acknowledgePlayback(document, preparedToolCallId, () => playMedia({
                    navigatorActionId: preparedToolCallId,
                    resumePositionTicks: action.resumePositionTicks,
                    id: isEpisode && action.seriesId ? action.seriesId : action.mediaId,
                    name: action.mediaName,
                    type: action.mediaType === "Movie" ? "movie" : "series",
                    streamUrl: action.streamUrl,
                    mediaSourceId: action.mediaSourceId || (isEpisode ? action.mediaId : undefined),
                    seriesId: action.seriesId, showName: action.showName, episodeTitle: action.episodeTitle,
                    seasonNumber: action.seasonNumber, episodeNumber: action.episodeNumber,
                    subtitleFilename: action.subtitleFilename, subtitleVideoSize: action.subtitleVideoSize,
                }), signal);
            }
            case "skipTo": {
                if (!isPlayerVisible || !Number.isFinite(action.timestamp) || action.timestamp < 0) throw new Error("There is no active player to seek.");
                skipToTimestamp(action.timestamp);
                playbackHandoffTimeRef.current = Date.now();
                setIsAskOpen(false);
                return { success: true, status: "requested", message: `Requested a seek to ${action.timestampFormatted}.` };
            }
            case "setTheme": {
                const nextTheme = action.theme === "toggle" ? (resolvedTheme === "dark" ? "light" : "dark") : action.theme;
                if (!["dark", "light", "system"].includes(nextTheme)) throw new Error("Invalid theme.");
                setTheme(nextTheme);
                return { success: true, status: "completed", message: `Theme changed to ${nextTheme}.` };
            }
            default: throw new Error("Unknown app action.");
            }
        } catch (error) {
            return { success: false, status: "failed", message: error instanceof Error ? error.message : "The app action failed." };
        }
    }

    const handleResetChat = () => {
        if (isBusy) return;
        clearError();
        setInput("");
        setMessages([]);
        setRequestDurationsMs({});
        actionAbortRef.current.abort();
        actionAbortRef.current = new AbortController();
        actionResultsRef.current.clear();
        if (historyKey) { try { localStorage.removeItem(historyKey); } catch { /* Storage may be unavailable; keep the live chat usable. */ } }
        taskStartTimeRef.current = null;
        activeTaskUserMessageIdRef.current = null;
        awaitingTaskUserMessageRef.current = false;
        messagesRef.current = [];
        opencodeSessionIdRef.current = null;
    };

    const isBusy = status === "submitted" || status === "streaming" || isApplyingAction;

    useEffect(() => {
        messagesRef.current = messages as any[];
    }, [messages]);

    useEffect(() => {
        // Tool-output updates can finish a browser action without another network onFinish.
        if (isBusy || taskStartTimeRef.current == null || !isNavigatorRequestSettled(messages)) return;
        if (shouldContinueAfterNavigatorAction(messages)
            && lastAssistantMessageIsCompleteWithToolCalls({ messages }) && continuationCountRef.current < 8) return;
        finalizeRequestDuration(true, messages);
    }, [messages, isBusy]);

    useEffect(() => {
        if (!awaitingTaskUserMessageRef.current) return;
        if (activeTaskUserMessageIdRef.current) return;

        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const message = messages[i] as any;
            if (message?.role !== "user") continue;
            const messageId = getStableMessageId(message, i);
            activeTaskUserMessageIdRef.current = messageId;
            awaitingTaskUserMessageRef.current = false;
            break;
        }
    }, [messages]);

    useEffect(() => {
        actionAbortRef.current.abort();
        stop();
        actionAbortRef.current = new AbortController();
        actionResultsRef.current.clear();
        requestBodyRef.current = {};
        opencodeSessionIdRef.current = null;
        setRequestDurationsMs({});
        // Conversation state belongs to this page session. Remove transcripts
        // saved by older versions, but never restore or persist them.
        try { if (historyKey) localStorage.removeItem(historyKey); } catch { /* Chat also works when storage is blocked. */ }
        setMessages([]);
        return () => { actionAbortRef.current.abort(); stop(); };
    }, [historyKey, setMessages, stop]);

    const prepareRequest = () => {
        actionAbortRef.current = new AbortController();
        continuationCountRef.current = 0;
        const media = isPlayerVisible ? currentMediaWithSource : null;
        subtitleSnapshotRef.current = subtitleQueries?.snapshot(media,
            AbortSignal.any([actionAbortRef.current.signal, AbortSignal.timeout(15_000)]));
        // Handle an early cancellation before the transport starts awaiting it.
        void subtitleSnapshotRef.current?.catch(() => undefined);
        const opencodeSessionId = opencodeSessionIdRef.current ?? crypto.randomUUID();
        opencodeSessionIdRef.current = opencodeSessionId;
        requestBodyRef.current = {
            currentMedia: media ? {
                id: media.id, name: media.name, type: media.type, mediaSourceId: media.mediaSourceId,
                seriesId: media.seriesId, showName: media.showName, episodeTitle: media.episodeTitle,
                seasonNumber: media.seasonNumber, episodeNumber: media.episodeNumber,
                subtitleFilename: media.subtitleFilename, subtitleVideoSize: media.subtitleVideoSize,
                poster: publicArtworkUrl(media.poster), thumbnail: publicArtworkUrl(media.thumbnail),
                backdropUrl: publicArtworkUrl(media.backdropUrl),
            } : null,
            currentTimestamp: playbackStore.get(currentTimestampAtom), pathname,
            aiProvider, openaiBaseUrl, openaiModel, openaiAuthMethod, chatGPTModel, geminiModel, ollamaApiKey, ollamaBaseUrl, ollamaModel,
            groqModel, openrouterModel, openrouterReasoningEffort, cerebrasModel, cerebrasReasoningEffort,
            opencodeModel, openaiApiKey: openaiAuthMethod === "chatgpt" ? undefined : openaiApiKey, googleApiKey, groqApiKey, openrouterApiKey, cerebrasApiKey,
            opencodeApiKey, opencodeSessionId,
        };
        taskStartTimeRef.current = Date.now();
        playbackHandoffTimeRef.current = null;
        activeTaskUserMessageIdRef.current = null;
        awaitingTaskUserMessageRef.current = true;
        clearError();
    };

    const handleSubmitQuestion = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!input.trim() || isBusy) {
            console.log("No input provided");
            return;
        }

        try {
            const question = input.trim();
            prepareRequest();
            setInput("");
            await sendMessage({ text: question });
        } catch (error) {
            console.error("Error asking question:", error);
        }
    };

    const handleStopGeneration = () => {
        actionAbortRef.current.abort();
        setIsApplyingAction(false);
        finalizeRequestDuration(false);
        stop();
        setMessages(current => markNavigatorRequestStopped(current));
    };

    const handleRetryRequest = async (userMessageId: string) => {
        if (isBusy) return;
        const question = messages.find(message => message.id === userMessageId && message.role === "user")?.parts
            .filter(part => part.type === "text").map(part => part.text).join("\n").trim();
        if (!question) return;
        prepareRequest();
        await sendMessage({ text: question });
    };

    const responseDurations = useMemo(
        () => navigatorResponseDurations(messages, requestDurationsMs),
        [messages, requestDurationsMs],
    );

    return (
        <NavigatorFocus
            open={isAskOpen}
            showLauncher={!isPlayerVisible}
            onOpen={handleOpenAsk}
            onOpenChange={setIsAskOpen}
            messages={messages}
            input={input}
            onInputChange={setInput}
            onSubmit={handleSubmitQuestion}
            onStop={handleStopGeneration}
            onRetryRequest={handleRetryRequest}
            onNewChat={handleResetChat}
            onRetry={() => {
                prepareRequest();
                const actions = preparedNavigatorActions(messages);
                if (actions.length) {
                    setIsApplyingAction(true);
                    void applyPreparedActions(actions, actionAbortRef.current.signal);
                } else void sendMessage();
            }}
            isBusy={isBusy}
            error={askError}
            responseDurations={responseDurations}
        />
    );
};

export default AIAsk;
