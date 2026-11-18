"use client";

import { NavigatorRequestError } from "@/components/navigator/request-error";

import {
  type ComponentProps,
  memo,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { UIMessage } from "ai";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  ArrowDown,
  Ship,
  ArrowUp as ArrowUpIcon,
  Plus as PlusIcon,
  Square as SquareIcon,
  Timer as TimerIcon,
} from "lucide-react";
import { BorderBeam } from "border-beam";
import { Streamdown, defaultComponents } from "streamdown";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { NavigatorLauncher } from "./launcher";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "./focus-ui/input-group";
import { NavigatorComposerInput } from "./composer-input";
import { NavigatorActivityStatus } from "./activity-status";
import {
  NavigatorTraceRow,
  NavigatorResultCards,
  NavigatorLookup,
  isPlaybackRequest,
  toNavigatorSegments,
} from "./focus-results";
import {
  getNavigatorActivityLabel,
  NAVIGATOR_ACTIVITY_VARIANT_COUNT,
} from "@/lib/navigator-activity-label";
import { cn } from "@/lib/utils";
import "./focus.css";
import floatingSurface from "@/components/arc/floating-surface.module.css";
import { motionTokens } from "@/components/arc/motion-tokens";
import { navigatorBeamColors } from "@/lib/navigator-beam";
import { createNavigatorRowDeriver, type NavigatorRow } from "@/lib/navigator-rows";

const markdownComponents = {
  a: (props: ComponentProps<typeof defaultComponents.a>) => <defaultComponents.a {...props} draggable={false} />,
};

function ActivityPill({
  label,
  reduceMotion,
  inline = false,
}: {
  label: string;
  reduceMotion: boolean | null;
  inline?: boolean;
}) {
  return (
    <motion.div
      className={
        inline
          ? "flex w-fit items-center"
          : "flex h-8 w-fit items-center rounded-full border border-border bg-popover/85 px-3 backdrop-blur-sm dark:bg-popover/75"
      }
      layoutId="navigator-activity-pill"
      layoutDependency={inline ? "inline" : "header"}
      transition={{
        layout: reduceMotion
          ? { duration: 0 }
          : { duration: 0.22, ease: [0.77, 0, 0.175, 1] },
      }}
    >
      <NavigatorActivityStatus label={label} />
    </motion.div>
  );
}

type Props = {
  open: boolean;
  showLauncher: boolean;
  onOpen: () => void;
  onOpenChange: (open: boolean) => void;
  messages: UIMessage[];
  input: string;
  onInputChange: (input: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  onNewChat: () => void;
  onRetry: () => void;
  onRetryRequest?: (_userMessageId: string) => void;
  isBusy: boolean;
  error?: Error;
  responseDurations: Record<string, number>;
};

const NavigatorMessageRow = memo(function NavigatorMessageRow({ row, duration, isBusy, onRetryRequest }: {
  row: NavigatorRow; duration: number | undefined; isBusy: boolean;
  onRetryRequest: (_id: string) => void;
}) {
  const { message, turn } = row;

  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const isShortUserMessage =
    message.role === "user" &&
    text.length <= 48 &&
    !text.includes("\n");

  const showCancelled = turn.cancelled && turn.statusMessageId === message.id;
  const stoppedStatus = showCancelled ? (
    <div className="mt-2 px-2 text-sm text-muted-foreground" role="status">
      <p>Stopped — this request is incomplete. Partial results have been kept.</p>
      <button type="button" className="mt-1 cursor-pointer underline underline-offset-4 disabled:opacity-50" disabled={isBusy} onClick={() => turn.user && onRetryRequest?.(turn.user.id)} draggable={false}>Retry request</button>
    </div>
  ) : null;
  const segments =
    message.role === "assistant"
      ? toNavigatorSegments(message.parts, {
          playbackRequest: isPlaybackRequest(turn.userText),
          turnParts: turn.parts,
          cancelled: turn.cancelled,
        })
      : [];

  if (message.role === "user") {
    if (!text) return null;
    return (
      <div key={message.id}>
      <motion.div
        animate={{ opacity: 1 }}
        className={`ml-auto w-fit max-w-[80%] bg-primary/10 px-4 py-2 text-primary backdrop-blur-sm ${isShortUserMessage ? "rounded-full" : "rounded-2xl"}`}
        initial={{ opacity: 0 }}
        key={message.id}
      >
        <p className="break-words whitespace-pre-wrap text-[15px] leading-6">
          {text}
        </p>
      </motion.div>
      {stoppedStatus}
      </div>
    );
  }

  if (!segments.length && duration === undefined && !showCancelled) return null;

  return (
    <div className={cn("w-full", row.previousAssistant && "mt-2!")} key={message.id}>
      {segments.map((segment, index) => {
        const previous = segments[index - 1];
        const spacing = !previous
          ? ""
          : previous.kind === "trace" && segment.kind === "results"
            ? ""
          : previous.kind === "trace" && segment.kind === "trace"
            ? ""
          : previous.kind === "results" && segment.kind === "trace"
            ? "mt-2"
          : previous.kind === "lookup" || segment.kind === "lookup" ||
              previous.kind === "trace" || segment.kind === "trace" ||
              previous.kind === "results" || segment.kind === "results"
            ? "mt-1"
          : previous.kind === "text" ||
              segment.kind === "text"
            ? "mt-3"
            : "mt-1";
        if (segment.kind === "text") {
          return (
            <div
              className={`w-full px-2 ${spacing}`}
              data-selectable-text=""
              key={segment.key}
            >
              <Streamdown
                components={markdownComponents}
                animated={false}
                className="break-words text-[15px] leading-6 [&>*]:first:mt-0 [&>*]:last:mb-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_pre]:text-sm [&_table]:text-sm"
                mode={
                  segment.streaming
                    ? "streaming"
                    : "static"
                }
              >
                {segment.text}
              </Streamdown>
            </div>
          );
        }

        if (segment.kind === "lookup") {
          return (
            <div className={spacing} key={segment.key}>
              <NavigatorLookup trace={segment.trace} cards={segment.cards} />
            </div>
          );
        }

        if (segment.kind === "trace") {
          return (
            <div className={spacing} key={segment.key}>
              <NavigatorTraceRow
                trace={segment.trace}
              />
            </div>
          );
        }

        if (segment.kind === "results") {
          return (
            <div className={spacing} key={segment.key}>
              <NavigatorResultCards
                {...segment.results}
              />
            </div>
          );
        }

        return null;
      })}
      {stoppedStatus}
      {!turn.cancelled && duration !== undefined ? (
        <p
          className="mt-2 flex items-center gap-1.5 px-2 text-[0.8125rem] font-normal leading-4 text-muted-foreground tabular-nums"
          aria-label={`${row.complete ? "Done" : "Finished"} in ${Math.max(1, Math.round(duration))} seconds`}
        >
          <TimerIcon
            aria-hidden="true"
            className="size-3.5"
          />
          {row.complete ? "Done" : "Finished"} in {Math.max(1, Math.round(duration))}s
        </p>
      ) : null}
    </div>
  );
});

export function NavigatorFocus({
  open,
  showLauncher,
  onOpen,
  onOpenChange,
  messages,
  input,
  onInputChange,
  onSubmit,
  onStop,
  onNewChat,
  onRetry,
  onRetryRequest,
  isBusy,
  error,
  responseDurations,
}: Props) {
  const deriveRows = useMemo(() => createNavigatorRowDeriver(), []);
  const rows = useMemo(() => deriveRows(messages), [deriveRows, messages]);
  const retryHandler = useRef(onRetryRequest);
  useLayoutEffect(() => { retryHandler.current = onRetryRequest; }, [onRetryRequest]);
  const retryRequest = useCallback((id: string) => { retryHandler.current?.(id); }, []);
  const { resolvedTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const [focusState, setFocusState] = useState<
    "closed" | "launcher-exiting" | "open" | "panel-exiting"
  >("closed");
  const isOpen = focusState === "open" || focusState === "panel-exiting";
  const focusPanelRef = useRef<HTMLDivElement>(null);
  const hasOpenedFocus = useRef(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottom = useRef(true);
  const [isScrolledAwayFromBottom, setIsScrolledAwayFromBottom] =
    useState(false);
  const [isClearingChat, setIsClearingChat] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activityStartedAt, setActivityStartedAt] = useState<number | null>(
    null,
  );
  const [activityVariant, setActivityVariant] = useState(0);

  useLayoutEffect(() => {
    setFocusState((state) =>
      open
        ? state === "closed"
          ? showLauncher
            ? "launcher-exiting"
            : "open"
          : state === "panel-exiting"
            ? "open"
            : state
        : state === "open"
          ? "panel-exiting"
          : state === "launcher-exiting"
            ? "closed"
            : state,
    );
  }, [open, showLauncher]);

  const latestMessage = messages.at(-1);
  const hasResponseStarted =
    latestMessage?.role === "assistant" &&
    latestMessage.parts.some(
      (part) =>
        part.type === "text" ||
        part.type.startsWith("tool-") ||
        part.type === "dynamic-tool",
    );
  const showTopActivity = isBusy && hasResponseStarted;
  const showInlineActivity = isBusy && !hasResponseStarted && !error;
  const activityLabel = getNavigatorActivityLabel(messages, activityVariant);
  const pillInitial = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, transform: "translateY(4px) scale(0.96)" };
  const pillExit = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, transform: "translateY(2px) scale(0.98)" };
  const clearedMessages = {
    height: 0,
    marginBottom: 0,
    opacity: 0,
    paddingBottom: 0,
    paddingTop: 0,
    ...(reduceMotion ? {} : { transform: "translateY(6px)" }),
  };

  useEffect(() => {
    if (!isOpen) return;
    const dismiss = (event: Event) => { event.preventDefault(); onOpenChange(false); };
    document.addEventListener("navigatornativeback", dismiss);
    return () => document.removeEventListener("navigatornativeback", dismiss);
  }, [isOpen, onOpenChange]);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const list = messageListRef.current;
      if (!list) return;
      isPinnedToBottom.current = true;
      setIsScrolledAwayFromBottom(false);
      if (list.scrollHeight <= list.clientHeight + 1) return;
      list.scrollTo({
        top: list.scrollHeight,
        behavior: reduceMotion ? "auto" : behavior,
      });
    },
    [reduceMotion],
  );
  const handleMessageScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight <= 24;
    isPinnedToBottom.current = atBottom;
    setIsScrolledAwayFromBottom(!atBottom);
  };
  useEffect(() => {
    setActivityStartedAt((started) =>
      isBusy ? (started ?? Date.now()) : null,
    );
  }, [isBusy]);
  useEffect(() => {
    if (!isOpen || !isPinnedToBottom.current) return;
    const frame = requestAnimationFrame(() => scrollToLatest("auto"));
    return () => cancelAnimationFrame(frame);
  }, [error, isBusy, isOpen, messages, responseDurations, scrollToLatest]);
  useEffect(() => {
    if (focusState !== "open") return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        !focusPanelRef.current ||
        event
          .composedPath()
          .some(
            (target) =>
              target === focusPanelRef.current ||
              (target instanceof Element &&
                target.hasAttribute("data-navigator-click-zone")),
          )
      )
        return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [focusState, onOpenChange]);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || isBusy || isClearingChat) return;
    isPinnedToBottom.current = true;
    setIsScrolledAwayFromBottom(false);
    setActivityVariant(
      (current) =>
        (current +
          1 +
          Math.floor(Math.random() * (NAVIGATOR_ACTIVITY_VARIANT_COUNT - 1))) %
        NAVIGATOR_ACTIVITY_VARIANT_COUNT,
    );
    setActivityStartedAt(Date.now());
    onSubmit(event);
  }
  function startNewChat() {
    if (!isClearingChat && !isBusy) setIsClearingChat(true);
  }
  function finishNewChat() {
    if (!isClearingChat || resetTimer.current) return;
    onNewChat();
    isPinnedToBottom.current = true;
    setIsScrolledAwayFromBottom(false);
    resetTimer.current = setTimeout(() => {
      setIsClearingChat(false);
      resetTimer.current = null;
    }, 180);
  }

  return (
    <div
      data-navigator-focus-ui=""
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-4 flex justify-center px-4",
        showLauncher
          ? "z-[var(--layer-navigator)]"
          : "z-[var(--layer-player-navigator)]",
      )}
    >
      <div className="pointer-events-auto flex w-full max-w-xl flex-col items-center">
        {isOpen ? (
          <div className="w-full" ref={focusPanelRef}>
            <LayoutGroup>
              <motion.div
                animate={
                  focusState === "panel-exiting"
                    ? {
                        opacity: 0,
                        transform: reduceMotion ? "none" : "translateY(24px)",
                      }
                    : { opacity: 1, transform: "translateY(0)" }
                }
                className="mb-2 w-full"
                initial={{
                  opacity: 0,
                  transform: reduceMotion ? "none" : "translateY(24px)",
                }}
                onAnimationComplete={() => {
                  if (focusState === "panel-exiting") {
                    setFocusState("closed");
                  }
                }}
                transition={{
                  duration: focusState === "panel-exiting"
                    ? motionTokens.duration.exit
                    : motionTokens.duration.standard,
                  ease: motionTokens.ease.out,
                }}
              >
                {(showTopActivity ||
                  (!isBusy && messages.length > 0) ||
                  isClearingChat) && (
                  <div
                    className="mb-2 flex h-7 items-center"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <AnimatePresence initial={false}>
                      {showTopActivity ? (
                        activityStartedAt ? (
                          <motion.div
                            animate={{ opacity: 1 }}
                            className="mr-auto"
                            exit={pillExit}
                            initial={false}
                            key="activity"
                            transition={{
                              duration: 0.18,
                              ease: [0.23, 1, 0.32, 1],
                            }}
                          >
                            <ActivityPill
                              label={activityLabel}
                              reduceMotion={reduceMotion}
                            />
                          </motion.div>
                        ) : null
                      ) : messages.length > 0 || isClearingChat ? (
                        <motion.div
                          animate={
                            isClearingChat
                              ? pillExit
                              : {
                                  opacity: 1,
                                  transform: "translateY(0) scale(1)",
                                }
                          }
                          className="ml-auto"
                          exit={pillExit}
                          initial={pillInitial}
                          key="new-chat"
                          transition={{
                            duration: 0.18,
                            ease: [0.23, 1, 0.32, 1],
                          }}
                        >
                          <Button
                            className="h-8 gap-1.5 rounded-full border border-border bg-popover/85 px-3 text-sm text-muted-foreground backdrop-blur-sm hover:bg-muted hover:text-foreground dark:bg-popover/75"
                            disabled={isClearingChat}
                            onClick={startNewChat}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <PlusIcon
                              aria-hidden="true"
                              className="size-3.5 stroke-2"
                            />
                            New
                          </Button>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                )}
                <BorderBeam
                  active={isBusy && !reduceMotion}
                  size="md"
                  css={navigatorBeamColors}
                  theme={resolvedTheme === "dark" ? "dark" : "light"}
                  staticColors
                  duration={4}
                  strength={1}
                  glowSize={1}
                  data-navigator-panel-shadow=""
                  className="w-full shadow-2xl shadow-primary/10 ring-1 ring-border dark:shadow-primary/15"
                >
                  <motion.section
                    aria-label="Ask Navigator"
                    data-player-hdr-glass={!showLauncher ? "" : undefined}
                    data-player-native-glass={!showLauncher ? "" : undefined}
                    className={cn("relative w-full rounded-xl! bg-popover/95 p-2 text-popover-foreground backdrop-blur-sm dark:bg-popover/75", !showLauncher && floatingSurface.surface)}
                    style={{ transformOrigin: "bottom center" }}
                  >
                    {(messages.length > 0 || error) && (
                      <motion.div
                        animate={
                          isClearingChat
                            ? clearedMessages
                            : { opacity: 1, transform: "translateY(0)" }
                        }
                        className="-mx-2 mb-3 h-fit max-h-72 space-y-4 px-3 py-2 sm:max-h-[min(26rem,calc(100dvh-12rem))]"
                        initial={false}
                        onScroll={handleMessageScroll}
                        onAnimationComplete={finishNewChat}
                        ref={messageListRef}
                        style={{
                          overflowY: "auto",
                          overflowX: "hidden",
                          overscrollBehavior: "contain",
                        }}
                        transition={{
                          duration: 0.18,
                          ease: [0.23, 1, 0.32, 1],
                        }}
                      >
                        {rows.map(row => <NavigatorMessageRow key={row.message.id} row={row}
                          duration={responseDurations[row.message.id]} isBusy={row.turn.cancelled && isBusy}
                          onRetryRequest={retryRequest} />)}
                        {showInlineActivity && activityStartedAt ? (
                          <div className="px-2" key="pending-activity">
                            <ActivityPill
                              label={activityLabel}
                              reduceMotion={reduceMotion}
                              inline
                            />
                          </div>
                        ) : null}
                        {error ? <NavigatorRequestError error={error} busy={isBusy} onRetry={onRetry} /> : null}
                      </motion.div>
                    )}
                    <motion.form className="relative" onSubmit={submit}>
                      {messages.length > 0 ? (
                        <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-2">
                          <button
                            aria-label="Jump to latest"
                            className={`cursor-pointer rounded-full border border-border/70 bg-card/90 shadow-xs backdrop-blur-md transition-[opacity,translate,scale] duration-150 ease-out will-change-[translate,opacity] hover:bg-muted active:scale-[0.98] motion-reduce:translate-y-0 motion-reduce:transition-opacity motion-reduce:active:scale-100 ${
                              isScrolledAwayFromBottom
                                ? "pointer-events-auto translate-y-0 opacity-100"
                                : "pointer-events-none translate-y-0.5 opacity-0"
                            }`}
                            onClick={() => scrollToLatest()}
                            title="Jump to latest"
                            type="button" draggable={false}
                          >
                            <span className="flex h-9 w-12 items-center justify-center text-foreground">
                              <ArrowDown
                                aria-hidden="true"
                                className="size-5"
                              />
                            </span>
                          </button>
                        </div>
                      ) : null}
                      <InputGroup style={{ background: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }} className="backdrop-blur-none h-auto! min-h-10 items-end rounded-lg! border-transparent bg-transparent py-[3px] shadow-none! ring-0 focus-within:border-transparent focus-within:ring-0 has-disabled:bg-transparent has-disabled:opacity-100 has-[[data-slot=input-group-control]:focus-visible]:border-transparent! has-[[data-slot=input-group-control]:focus-visible]:ring-0! dark:bg-transparent dark:has-disabled:bg-transparent">
                        <InputGroupAddon className="shrink-0 cursor-default self-end px-2.5">
                          <Ship
                            aria-hidden="true"
                            className="size-5 stroke-[1.5]"
                          />
                        </InputGroupAddon>
                        <NavigatorComposerInput
                          disabled={isBusy}
                          onValueChange={onInputChange}
                          value={input}
                        />
                        <InputGroupButton
                          aria-label={isBusy ? "Stop response" : "Send message"}
                          className="mr-1 shrink-0 self-end text-muted-foreground"
                          disabled={!isBusy && !input.trim()}
                          size="icon-sm"
                          type={isBusy ? "button" : "submit"}
                          onClick={isBusy ? onStop : undefined}
                        >
                          {isBusy ? (
                            <SquareIcon className="size-4 stroke-2 opacity-70" />
                          ) : (
                            <ArrowUpIcon className="size-5" />
                          )}
                        </InputGroupButton>
                      </InputGroup>
                    </motion.form>
                  </motion.section>
                </BorderBeam>
              </motion.div>
            </LayoutGroup>
          </div>
        ) : showLauncher ? (
          <motion.div
            className="mb-0 sm:mb-1"
            animate={
              focusState === "launcher-exiting"
                ? {
                    opacity: 0,
                    transform: reduceMotion ? "none" : "translateY(8px)",
                  }
                : { opacity: 1, transform: "translateY(0)" }
            }
            initial={
              hasOpenedFocus.current
                ? {
                    opacity: 0,
                    transform: reduceMotion ? "none" : "translateY(8px)",
                  }
                : false
            }
            onAnimationComplete={() => {
              if (focusState === "launcher-exiting") {
                hasOpenedFocus.current = true;
                setFocusState("open");
              }
            }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          >
            <NavigatorLauncher onClick={onOpen} expanded={isOpen} />
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
