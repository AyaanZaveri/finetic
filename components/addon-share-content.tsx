"use client";

import { useId } from "react";
import { Copy } from "lucide-react";
import { AddonPreviewCard } from "@/components/addon-preview-card";
import { DialogClose, DialogContent } from "@/components/arc/dialog/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AddonListItem } from "@/lib/addons";
import styles from "./addons-list.module.css";

export type AddonShareState =
    | { kind: "loading" }
    | { kind: "unavailable"; message: string }
    | { kind: "ready" | "copying"; url: string }
    | { kind: "copy-error"; url: string; message: string };

export function AddonShareContent({ addon, state, onCopy }: {
    addon: AddonListItem;
    state: AddonShareState;
    onCopy(): void;
}) {
    const id = useId();
    return <DialogContent title="Share addon" description="Copy the manifest link to install this addon in Stremio.">
        <div className={styles.dialogBody}>
            <AddonPreviewCard addon={addon} />
            {"url" in state && <>
                <label htmlFor={id} className="text-sm font-medium">Addon link</label>
                <Input id={id} value={state.url} readOnly onFocus={event => event.currentTarget.select()}
                    aria-describedby={addon.configurable ? `${id}-warning` : undefined} />
                {addon.configurable && <p id={`${id}-warning`} className="text-sm text-muted-foreground">
                    This link may include your personal addon settings. Share it only with people you trust.
                </p>}
            </>}
            {state.kind === "loading" && <p role="status">Loading addon link…</p>}
            {"message" in state && <p role="alert" className={styles.error}>{state.message}</p>}
            <div className={styles.dialogActions}>
                <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
                <Button disabled={!("url" in state) || state.kind === "copying"} onClick={onCopy}>
                    <Copy data-icon="inline-start" aria-hidden="true" />
                    {state.kind === "copying" ? "Copying…" : "Copy link"}
                </Button>
            </div>
        </div>
    </DialogContent>;
}
