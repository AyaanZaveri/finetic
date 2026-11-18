"use client";

import { Fragment, useEffect, useRef, useState, type ReactElement } from "react";
import { useActionMenuHighlight } from "@/components/use-action-menu-highlight";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Check, Eye, Info, ListVideo, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/account-ui/drawer";
import { useAccountAccess } from "@/contexts/account-context";
import { useWatchStatus } from "@/contexts/watch-history-context";
import { fetchPlaybackProgress, type PlaybackProgressState } from "@/app/actions/media";
import { removeFromContinueWatching } from "@/app/actions/continue-watching";
import { fetchPlaybackId } from "@/lib/media/fetch-playback-id";
import { buildSeriesPath, parseSeriesRouteId } from "@/lib/series-route";
import { WATCH_HISTORY_CHANGED } from "@/lib/watch-history";
import { removeContinueWatchingCard } from "@/lib/media/continue-watching-query";
import { useStreamQueries } from "@/components/stream-query-provider";
import type { MediaItem } from "@/types/stremio";
import accountSurface from "@/components/account-ui/surface.module.css";
import glass from "@/components/arc/floating-surface.module.css";

export type CardPlayback = { fromBeginning: boolean; titleId: string; videoId?: string; resumePosition?: number };

/** Use the existing card as the trigger, without another hit target or tab stop. */
export function MediaCardMenu({ item, continueWatching, detailsHref, onPlay, onResolvedId, children }: {
    item: MediaItem; continueWatching: boolean; detailsHref: string;
    onPlay: (_playback: CardPlayback) => Promise<void>; onResolvedId?: (_id: string) => void; children: ReactElement;
}) {
    const router = useRouter();
    const queries = useStreamQueries();
    const { authenticated, requestSignIn } = useAccountAccess();
    const [menuOpen, setMenuOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { groupProps, highlightElement, resetHighlight } = useActionMenuHighlight();
    const [progress, setProgress] = useState<PlaybackProgressState | null>(null);
    const [resolvedId, setResolvedId] = useState<string | null>(null);
    const [reading, setReading] = useState(false);
    const [busy, setBusy] = useState(false);
    const returnFocus = useRef<HTMLElement | null>(null);
    const suppressClick = useRef(false);
    const touchInvocation = useRef(false);
    const originalTitleId = item.seriesId || (item.type === "series" ? parseSeriesRouteId(item.id).seriesId : item.id);
    const titleId = resolvedId || originalTitleId;
    const explicitVideoId = item.mediaSourceId || item.episodeId || (item.type === "series" && item.seasonNumber !== undefined && item.episodeNumber !== undefined
        ? `${originalTitleId}:${item.seasonNumber}:${item.episodeNumber}` : undefined);
    const videoId = explicitVideoId && (explicitVideoId === originalTitleId || explicitVideoId.startsWith(`${originalTitleId}:`))
        ? titleId + explicitVideoId.slice(originalTitleId.length) : explicitVideoId || (progress?.resumePositionTicks ? progress.videoId : undefined);
    const status = useWatchStatus(titleId, item.type, item.type === "series" ? videoId : undefined);
    const resumePosition = continueWatching ? item.resumePositionTicks : progress?.resumePositionTicks ?? item.resumePositionTicks;
    const canResume = typeof resumePosition === "number" && resumePosition > 0;
    const isEpisode = item.type === "series" && !!videoId;
    const episode = videoId ? parseSeriesRouteId(videoId) : null;
    const episodeLabel = episode?.isEpisodeTarget ? `S${episode.season} · E${episode.episode}` : undefined;
    const opened = menuOpen || drawerOpen;

    useEffect(() => {
        if (!opened || !authenticated || continueWatching || (item.type !== "movie" && item.type !== "series")) return;
        let cancelled = false;
        const controller = new AbortController();
        void (async () => {
            const id = /^tmdb:/.test(originalTitleId) ? await fetchPlaybackId(originalTitleId, item.type as "movie" | "series", controller.signal) : originalTitleId;
            const targetVideo = explicitVideoId && (explicitVideoId === originalTitleId || explicitVideoId.startsWith(`${originalTitleId}:`)) ? id + explicitVideoId.slice(originalTitleId.length) : explicitVideoId;
            const saved = await fetchPlaybackProgress(id, targetVideo);
            if (!cancelled) { setResolvedId(id); setProgress(saved); onResolvedId?.(id); }
        })().catch(() => { /* Playback can still resolve a fresh title. */ }).finally(() => { if (!cancelled) setReading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [opened, authenticated, continueWatching, originalTitleId, explicitVideoId, item.type, onResolvedId]);

    const close = () => { setMenuOpen(false); setDrawerOpen(false); setReading(false); resetHighlight(); };
    const act = async (action: () => void | Promise<void>) => {
        if (busy) return;
        close(); setBusy(true);
        try { await action(); } catch { toast.error("Could not complete that action. Try again."); }
        finally { setBusy(false); }
    };
    const play = (fromBeginning = false) => act(async () => {
        if (!authenticated) { requestSignIn(); return; }
        await onPlay({ fromBeginning, titleId, videoId, resumePosition: fromBeginning ? 0 : resumePosition });
    });
    const clearResume = async (save: () => Promise<boolean>) => {
        if (queries) await removeContinueWatchingCard(queries.client, queries.scope, item, save);
        else if (!await save()) throw new Error("Could not update Continue Watching");
        window.dispatchEvent(new CustomEvent(WATCH_HISTORY_CHANGED, { detail: { id: titleId } }));
    };
    const actions = [
        { id: "play", label: canResume ? "Resume" : "Play", icon: Play, disabled: reading, run: () => play() },
        ...(canResume ? [{ id: "restart", label: "Play from beginning", icon: RotateCcw, disabled: reading, run: () => play(true) }] : []),
        { id: "details", label: "View details", icon: Info, run: () => act(() => { router.push(detailsHref, { scroll: false }); }) },
        ...(isEpisode && explicitVideoId ? [{ id: "series", label: "View series", icon: ListVideo, run: () => act(() => { router.push(buildSeriesPath(titleId), { scroll: false }); }) }] : []),
        ...(authenticated && (item.type === "movie" || isEpisode) ? [{
            id: "watched", label: isEpisode ? `Mark episode as ${status.watched ? "unwatched" : "watched"}` : `Mark as ${status.watched ? "unwatched" : "watched"}`,
            icon: status.watched ? Eye : Check, disabled: !status.known || reading,
            run: () => act(async () => {
                const save = () => status.toggle(item.showName || item.name);
                // Changing the watched flag for the current video clears its resume position.
                if (continueWatching) await clearResume(save);
                else if (!await save()) throw new Error("Watch status failed");
            }),
        }] : []),
        ...(authenticated && continueWatching && (item.type === "movie" || item.type === "series") ? [{
            id: "remove", label: "Remove from Continue Watching", icon: X,
            run: () => act(() => clearResume(() => removeFromContinueWatching({ id: titleId, type: item.type as "movie" | "series", videoId }))),
        }] : []),
    ];

    return <>
        <ContextMenu open={menuOpen} onOpenChange={open => {
            resetHighlight();
            if (open) {
                setReading(authenticated && !continueWatching && (item.type === "movie" || item.type === "series"));
                if (touchInvocation.current || window.matchMedia("(max-width: 639px)").matches) {
                    suppressClick.current = true; setDrawerOpen(true); return;
                }
            }
            setMenuOpen(open);
        }}>
            <ContextMenuTrigger asChild
                onPointerDownCapture={event => {
                    if (!event.currentTarget.contains(event.target as Node)) return;
                    suppressClick.current = false;
                    touchInvocation.current = event.pointerType === "touch" || event.pointerType === "pen";
                    returnFocus.current = event.target instanceof Element ? event.target.closest<HTMLElement>("a,button") : null;
                }}
                onContextMenu={event => {
                    returnFocus.current = event.target instanceof Element ? event.target.closest<HTMLElement>("a,button") : null;
                }}
                onClickCapture={event => {
                    if (suppressClick.current && event.currentTarget.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); }
                }}
                onKeyDown={event => {
                    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                    event.preventDefault(); event.stopPropagation();
                    touchInvocation.current = false;
                    const target = event.target as HTMLElement;
                    const rect = target.getBoundingClientRect();
                    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: rect.top + 12 }));
                }}>{children}</ContextMenuTrigger>
            <ContextMenuContent aria-label={`Actions for ${item.name}`} collisionPadding={12} className={`w-64 ${glass.surface}`}
                onCloseAutoFocus={event => {
                    if (!returnFocus.current?.isConnected) return;
                    event.preventDefault(); returnFocus.current.focus({ preventScroll: true });
                }}>
                <ContextMenuGroup {...groupProps}>
                    {highlightElement}
                    <ContextMenuLabel className="truncate">{item.showName || item.name}{episodeLabel ? ` · ${episodeLabel}` : ""}</ContextMenuLabel>
                    {actions.map(({ id, label, icon: Icon, disabled, run }) => <Fragment key={id}>
                        {id === "remove" && <ContextMenuSeparator />}
                        <ContextMenuItem data-card-menu-item="" className="focus:bg-transparent" disabled={disabled || busy} onSelect={run} textValue={label}>
                            <Icon aria-hidden="true" />{label}
                        </ContextMenuItem>
                    </Fragment>)}
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} showSwipeHandle>
            <DrawerContent className={`${accountSurface.surface} [--drawer-inset:0.5rem] after:hidden`} finalFocus={returnFocus}>
                <DrawerHeader>
                    <DrawerTitle>{item.showName || item.name}</DrawerTitle>
                    <DrawerDescription>{episodeLabel || item.progressLabel || item.episodeTitle || "Choose an action"}</DrawerDescription>
                </DrawerHeader>
                <div className="flex min-h-0 flex-col overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    {actions.map(({ id, label, icon: Icon, disabled, run }) => <Button key={id} type="button" variant="ghost" className="min-h-12 w-full justify-start" disabled={disabled || busy} onClick={run}>
                        <Icon data-icon="inline-start" aria-hidden="true" />{label}
                    </Button>)}
                </div>
            </DrawerContent>
        </Drawer>
    </>;
}
