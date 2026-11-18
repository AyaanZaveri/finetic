"use client";

import { useEffect, useState } from "react";
import { desktopBridge, type UpdateStatus } from "@/lib/desktop/bridge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/arc/switch/switch";
import { Field, FieldContent, FieldLabel, FieldDescription } from "@/components/ui/field";
import { GitHubIcon } from "@/components/github-icon";
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
    const checking = status?.state === "checking" || status?.state === "downloading";
    const ready = status?.state === "ready";
    return <section className={styles.section} aria-label="About Navigator">
        <h2>Navigator {status?.version ?? version}</h2>
        {status ? <>
            <p className={styles.credits}>Download updates from GitHub and choose when to restart. Your sign-in and settings stay on this device.</p>
            {status.available ? <>
                <Field orientation="horizontal">
                    <FieldContent>
                        <FieldLabel htmlFor="automatic-app-updates">Download updates automatically</FieldLabel>
                        <FieldDescription>Check and download in the background. Choose when to restart and install.</FieldDescription>
                    </FieldContent>
                    <Switch id="automatic-app-updates" checked={status.automatic}
                        onCheckedChange={enabled => desktopBridge()?.send({ type: "update-automatic", enabled })} />
                </Field>
                <div><Button variant="outline" disabled={checking} onClick={() => desktopBridge()?.send({ type: "update-check" })}>
                    {ready ? "Restart to update" : status.state === "downloading" ? "Downloading…" : checking ? "Checking…" : "Check for updates"}
                </Button></div>
            </> : <p className={styles.credits}>In-app updates require an installed desktop app. Install the latest version to enable updates.</p>}
            <p role="status" aria-live="polite" className={styles.credits}>
                {status.message ?? (ready ? "The update is ready. Restart when it suits you." : status.state === "downloading" ? "Downloading the update in the background…" : checking ? "Checking for updates…" : status.state === "current" ? "You’re up to date." : status.state === "available" ? "An update is available." : "")}
            </p>
        </> : null}
        <div><Button asChild variant="outline" size="sm">
            <a draggable={false} href="https://github.com/AyaanZaveri/navigator/releases" target="_blank" rel="noreferrer">
                <GitHubIcon data-icon="inline-start" />
                View releases on GitHub
            </a>
        </Button></div>
    </section>;
}
