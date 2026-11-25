"use client";

import { ArrowUpRight, CheckCircle, FileText } from "lucide-react";
import { desktopBridge } from "@/lib/desktop/bridge";
import { useAppUpdate } from "@/components/desktop/app-update-provider";
import { appReleasesUrl } from "@/lib/app-update-notes";
import { Button } from "@/components/ui/button";
import { ActivityTextShimmer } from "@/components/motion-primitives/activity-text-shimmer";
import { Switch } from "@/components/arc/switch/switch";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { GitHubIcon } from "@/components/github-icon";
import externalLink from "@/components/external-link-reveal.module.css";
import { version } from "@/package.json";
import styles from "@/app/(main)/settings/settings.module.css";

export function AppUpdates() {
    const { status, openUpdate, requestUpdate } = useAppUpdate();
    const state = status?.state;
    const activity = state === "installing" ? "Restarting Navigator…"
        : state === "downloading" ? "Downloading update…" : state === "checking" ? "Checking for updates…" : null;
    const offered = state === "ready" || state === "available";
    const action = offered ? "Review update" : "Check for updates";
    const feedback = state === "error" ? (status?.message ?? "Couldn’t update Navigator. Try again.")
        : state === "current" ? "You’re up to date." : "";
    const announcement = feedback || (status?.available
        ? activity ?? (state === "ready" ? "Update ready to install." : state === "available" ? "Update available." : "")
        : "");

    return <section className={styles.section} aria-label="About Navigator">
        <h2>Navigator {status?.version ?? version}</h2>
        {status?.available ? <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor="automatic-app-updates">Download updates automatically</FieldLabel></FieldContent>
            <Switch id="automatic-app-updates" checked={status.automatic}
                onCheckedChange={enabled => desktopBridge()?.send({ type: "update-automatic", enabled })} />
        </Field> : status && <p className={styles.description}>Install Navigator to use in-app updates.</p>}
        <div className="flex flex-wrap items-center gap-2">
            {status?.available && <Button type="button" variant="outline" size="sm" disabled={!!activity} aria-busy={!!activity || undefined}
                aria-haspopup={offered ? "dialog" : undefined}
                onClick={event => offered ? openUpdate(event.currentTarget) : requestUpdate("prepare")}>
                {activity ? <ActivityTextShimmer>{activity}</ActivityTextShimmer> : action}
            </Button>}
            {status?.available && <Button type="button" variant="outline" size="sm"
                aria-haspopup="dialog" onClick={event => openUpdate(event.currentTarget, "installed")}>
                <FileText className="text-muted-foreground" data-icon="inline-start" aria-hidden="true" />
                Release notes
            </Button>}
            <Button asChild variant={status?.available ? "ghost" : "outline"} size="sm">
                <a draggable={false} className={externalLink.link} href={appReleasesUrl} target="_blank" rel="noreferrer">
                    <GitHubIcon className="size-[15px]" data-icon="inline-start" />
                    <span className="inline-flex items-center">
                        GitHub releases
                        <span className={externalLink.arrow} aria-hidden="true">
                            <ArrowUpRight className="size-4" strokeWidth={2} absoluteStrokeWidth />
                        </span>
                    </span>
                </a>
            </Button>
        </div>
        {status && <p role="status" className={state === "current" ? `${styles.feedback} flex items-center gap-1.5` : feedback ? styles.feedback : "sr-only"}>
            {state === "current" ? <>
                <CheckCircle className="size-3.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
                {announcement}
            </> : announcement}
        </p>}
    </section>;
}
