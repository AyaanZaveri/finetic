"use client";

import { useEffect, useState } from "react";
import { desktopBridge, type UpdateStatus } from "@/lib/desktop/bridge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/arc/switch/switch";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { GitHubIcon } from "@/components/github-icon";
import { ActivityTextShimmer } from "@/components/motion-primitives/activity-text-shimmer";
import { version } from "@/package.json";
import styles from "@/app/(main)/settings/settings.module.css";

export function AppUpdates() {
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    useEffect(() => {
        const bridge = desktopBridge();
        if (!bridge?.capabilities?.updates) return;
        const unsubscribe = bridge.subscribe(message => { if (message.type === "update-status") setStatus(message); });
        bridge.send({ type: "update-status" });
        return unsubscribe;
    }, []);
    const state = status?.state;
    const activity = state === "downloading" ? "Downloading update…" : state === "checking" ? "Checking for updates…" : null;
    const action = state === "ready" ? "Restart to update" : state === "available" ? "Download update" : "Check for updates";
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
            {status?.available && <Button type="button" variant="outline" className="min-w-40" disabled={!!activity} aria-busy={!!activity || undefined}
                onClick={() => desktopBridge()?.send({ type: "update-check" })}>
                {activity ? <ActivityTextShimmer>{activity}</ActivityTextShimmer> : action}
            </Button>}
            <Button asChild variant={status?.available ? "ghost" : "outline"} size="sm">
                <a draggable={false} href="https://github.com/AyaanZaveri/navigator/releases" target="_blank" rel="noreferrer">
                    <GitHubIcon data-icon="inline-start" />
                    GitHub releases
                </a>
            </Button>
        </div>
        {status && <p role="status" className={feedback ? styles.feedback : "sr-only"}>{announcement}</p>}
    </section>;
}
