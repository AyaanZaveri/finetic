"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Settings, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getInstalledAddonLinks, uninstallAddon } from "@/app/actions/addons";
import { Button } from "@/components/ui/button";
import { AddonShareContent, type AddonShareState } from "@/components/addon-share-content";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { AddonListItem } from "@/lib/addons";
import styles from "./addons-list.module.css";
import { useStreamQueries } from "@/components/stream-query-provider";

export function AddonActions({ addon, onUninstalled, onRemovalFocus }: { addon: AddonListItem; onUninstalled: (_options: { animate: boolean }) => void; onRemovalFocus: () => void }) {
    const queries = useStreamQueries();
    const configuring = useRef(false);
    useEffect(() => {
        const returned = () => { if (configuring.current) { configuring.current = false; queries?.invalidate(); } };
        window.addEventListener("focus", returned);
        return () => window.removeEventListener("focus", returned);
    }, [queries]);
    const uninstalled = useRef(false);
    const shareTrigger = useRef<HTMLButtonElement>(null);
    const [shareOpen, setShareOpen] = useState(false);
    const [removeOpen, setRemoveOpen] = useState(false);
    const [share, setShare] = useState<AddonShareState>({ kind: "loading" });
    const shareSession = useRef(0);
    const [removeError, setRemoveError] = useState<string | null>(null);
    const [removing, setRemoving] = useState(false);

    function changeShareOpen(open: boolean) {
        shareSession.current++;
        if (open) setShare({ kind: "loading" });
        setShareOpen(open);
    }

    useEffect(() => {
        if (!shareOpen) return;
        let active = true;
        const fallback = "Could not load the addon link. Close this dialog and try again.";
        void getInstalledAddonLinks(addon.id).then(result => {
            if (!active) return;
            setShare(result.shareUrl ? { kind: "ready", url: result.shareUrl }
                : { kind: "unavailable", message: result.error ?? fallback });
        }).catch(() => {
            if (active) setShare({ kind: "unavailable", message: fallback });
        });
        return () => { active = false; };
    }, [shareOpen, addon.id]);

    async function copyLink() {
        if (!("url" in share) || share.kind === "copying") return;
        const { url } = share;
        const session = shareSession.current;
        setShare({ kind: "copying", url });
        try {
            await navigator.clipboard.writeText(url);
            if (session !== shareSession.current) return;
            setShare({ kind: "ready", url });
            toast.success("Addon link copied");
        } catch {
            if (session !== shareSession.current) return;
            setShare({ kind: "copy-error", url, message: "Could not copy automatically. Select the link and copy it manually." });
        }
    }

    async function remove(animate: boolean) {
        if (removing) return;
        setRemoving(true);
        setRemoveError(null);
        try {
            const result = await uninstallAddon(addon.id);
            if (result.error) { setRemoveError(result.error); return; }
            queries?.invalidate();
            toast.success(`${addon.name} uninstalled`);
            uninstalled.current = true;
            setRemoveOpen(false);
            onUninstalled({ animate });
        } catch {
            setRemoveError("Could not uninstall this addon. Please try again.");
        } finally { setRemoving(false); }
    }

    return (
        <div className={styles.actions}>
            <div className={styles.primaryActions}>
                {addon.configurable && (
                    <Button asChild variant="outline" size="sm">
                        <a draggable={false} href={`/api/addons/${addon.id}/configure`} onClick={() => { configuring.current = true; }} target="_blank" rel="noopener noreferrer" aria-label={`Settings for ${addon.name} (opens in a new tab)`}>
                            <Settings data-icon="inline-start" aria-hidden="true" />Settings
                        </a>
                    </Button>
                )}
                <Button ref={shareTrigger} variant="outline" size="sm" aria-label={`Share ${addon.name}`} aria-haspopup="dialog"
                    aria-expanded={shareOpen} onClick={() => changeShareOpen(true)}>
                    <Share2 data-icon="inline-start" aria-hidden="true" />Share
                </Button>
                <AddonShareContent addon={addon} state={share} onCopy={copyLink}
                    open={shareOpen} onOpenChange={changeShareOpen} finalFocus={shareTrigger} />
            </div>
            {!addon.protected && (
                <AlertDialog open={removeOpen} onOpenChange={(open) => { if (!removing) { setRemoveOpen(open); setRemoveError(null); } }}>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className={styles.removeAction} aria-label={`Uninstall ${addon.name}`}><Trash2 data-icon="inline-start" aria-hidden="true" />Uninstall</Button></AlertDialogTrigger>
                    <AlertDialogContent aria-busy={removing} onCloseAutoFocus={event => {
                        if (uninstalled.current) {
                            event.preventDefault();
                            onRemovalFocus();
                        }
                    }}>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Uninstall {addon.name}?</AlertDialogTitle>
                            <AlertDialogDescription>This removes this addon configuration from your Stremio account and all your synced devices. You can install it again later.</AlertDialogDescription>
                        </AlertDialogHeader>
                        {removeError && <p role="alert" className={styles.error}>{removeError}</p>}
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" disabled={removing} onClick={(event) => { event.preventDefault(); void remove(event.detail > 0); }}>
                                {removing ? (
                                    <>
                                        <Loader2 data-icon="inline-start" aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                                            Uninstalling
                                    </>
                                ) : "Uninstall addon"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
}
