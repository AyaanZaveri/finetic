"use client";

import { useEffect, useState, type RefObject } from "react";
import { ArrowUpRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/account-ui/dialog";
import surface from "@/components/account-ui/surface.module.css";
import { Button } from "@/components/ui/button";
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder";
import { Skeleton } from "@/components/ui/skeleton";
import { GitHubIcon } from "@/components/github-icon";
import externalLink from "@/components/external-link-reveal.module.css";
import { appReleaseUrl, compareReleaseVersions, formatReleaseNotesForDialog, releaseVersionPattern, type ReleaseHistory } from "@/lib/app-update-notes";
import type { UpdateStatus } from "@/lib/desktop/bridge";

export function AppUpdateDialog({ status, view, open, triggerRef, onClose, requestUpdate }: {
    status: UpdateStatus;
    view: "update" | "installed";
    open: boolean;
    triggerRef: RefObject<HTMLElement | null>;
    onClose: () => void;
    requestUpdate: (_intent: "prepare" | "install") => void;
}) {
    const installed = view === "installed";
    const selectedVersion = installed ? status.version : status.nextVersion;
    const version = selectedVersion && releaseVersionPattern.test(selectedVersion) ? selectedVersion : null;
    const since = !installed && version && releaseVersionPattern.test(status.version) && compareReleaseVersions(status.version, version) < 0
        ? status.version : null;
    const notesUrl = version ? `/api/updates/release-notes?version=${version}${since ? `&since=${since}` : ""}` : null;
    const [result, setResult] = useState<{ url: string; history: ReleaseHistory }>();

    useEffect(() => {
        if (!open || !version || !notesUrl) return;
        const controller = new AbortController();
        const setHistory = (history: ReleaseHistory) => {
            if (!controller.signal.aborted) setResult({ url: notesUrl, history });
        };
        void fetch(notesUrl, { signal: controller.signal })
            .then(response => response.ok ? response.json() : null)
            .then(data => {
                if (Array.isArray(data?.releases)) setHistory(data);
                else setHistory({ releases: typeof data?.notes === "string" && data.notes ? [{ version, notes: data.notes }] : [], complete: !since });
            })
            .catch(() => setHistory({ releases: [], complete: false }));
        return () => controller.abort();
    }, [open, version, notesUrl, since]);

    const ready = status.state === "ready";
    const pending = status.state === "checking" || status.state === "downloading" || status.state === "installing";
    const progress = status.state === "installing" ? "Restarting Navigator…" : status.state === "downloading" ? "Downloading update…" : "Checking for updates…";
    const action = ready ? "Restart to update" : status.state === "available" ? "Download update" : "Check for updates";
    const history = result?.url === notesUrl ? result.history : undefined;
    const loadingNotes = !!notesUrl && !history;
    const description = installed ? "Changes in your installed version."
        : ready ? since ? `Navigator will update to ${version} and reopen automatically.` : "Navigator will reopen automatically."
        : pending ? progress
        : status.state === "current" ? "You’re up to date."
        : status.state === "error" ? status.message ?? "Couldn’t update Navigator. Try again."
        : since ? `Navigator ${version} is available to download.` : "Review the changes before updating Navigator.";

    return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
        <DialogContent overlayClassName={surface.addonBackdrop}
            className={`${surface.surface} grid-rows-[auto_minmax(0,1fr)_auto] max-h-[calc(100dvh-2rem)] gap-7 p-6 sm:max-w-[560px]`}
            finalFocus={triggerRef}>
            <DialogHeader className="pr-8">
                <DialogTitle>{since ? `What’s new since Navigator ${since}` : version ? `What’s new in Navigator ${version}` : "Navigator update"}</DialogTitle>
                <DialogDescription aria-live="polite">{description}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto overscroll-contain pe-3 text-muted-foreground"
                tabIndex={since && history?.releases.length ? 0 : undefined} aria-label={since ? "Release notes by version" : undefined}
                role={since ? "region" : undefined}>
                {history?.releases.length ? <div className="grid gap-5">
                    {!history.complete && <p role="status" className="text-sm">Some release notes are unavailable. See GitHub for the full history.</p>}
                    {history.releases.map(release => <section key={release.version}
                        className="[&+section]:border-t [&+section]:border-border [&+section]:pt-5 [&_ul]:grid [&_ul]:gap-4 [&_li>strong:first-child]:mb-1 [&_li>strong:first-child]:block [&_strong]:font-semibold [&_strong]:text-foreground">
                        {since && <h3 className="mb-3 text-sm font-semibold text-foreground">Navigator {release.version}</h3>}
                        {release.notes ? <ReactMarkdown skipHtml allowedElements={["p", "ul", "ol", "li", "strong", "em", "code"]} unwrapDisallowed>
                            {formatReleaseNotesForDialog(release.notes)}
                        </ReactMarkdown> : <a className="text-sm underline underline-offset-4" href={appReleaseUrl(release.version)} target="_blank" rel="noreferrer">
                            Read the {release.version} release notes on GitHub
                        </a>}
                    </section>)}
                </div> : loadingNotes ? <>
                    <p role="status" className="sr-only">Loading release notes</p>
                    <LoadingPlaceholder className="grid gap-4">
                        {["w-3/5", "w-4/5", "w-2/3"].map(width => <div key={width} className="grid gap-2">
                            <Skeleton className="h-3.5 w-1/3" />
                            <Skeleton className="h-3 w-full" />
                            <Skeleton className={`h-3 ${width}`} />
                        </div>)}
                    </LoadingPlaceholder>
                </> : version && <p role="status">Couldn’t load release notes.</p>}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
                <Button asChild variant="outline" size="sm" className="me-auto">
                    <a draggable={false} className={externalLink.link} href={appReleaseUrl(since ? null : version)} target="_blank" rel="noreferrer">
                        <GitHubIcon className="size-4" data-icon="inline-start" />
                        <span className="inline-flex items-center">
                            GitHub release notes
                            <span className={externalLink.arrow} aria-hidden="true">
                                <ArrowUpRight className="size-4" strokeWidth={2} absoluteStrokeWidth />
                            </span>
                        </span>
                    </a>
                </Button>
                <DialogClose render={<Button type="button" variant="outline" size="sm" />}>
                    {installed || status.state === "current" ? "Close" : "Not now"}
                </DialogClose>
                {!installed && status.state !== "current" && <Button type="button" variant="primary" size="sm"
                    disabled={pending} aria-busy={pending || undefined} onClick={() => requestUpdate(ready ? "install" : "prepare")}>
                    {pending ? progress : action}
                </Button>}
            </div>
        </DialogContent>
    </Dialog>;
}
