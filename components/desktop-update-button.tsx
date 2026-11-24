"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppUpdate } from "@/components/desktop/app-update-provider";

/** Keep updates reachable before sign-in as well as from Settings → About. */
export function DesktopUpdateButton() {
    const { status, openUpdate } = useAppUpdate();
    if (!status?.available || !["available", "ready"].includes(status.state)) return null;
    const ready = status.state === "ready";
    const label = ready ? "Update ready" : "Update available";
    return <Button variant="outline" className="max-sm:size-11 max-sm:p-0"
        aria-label={`${label}. Review update.`} title={label} aria-haspopup="dialog"
        onClick={event => openUpdate(event.currentTarget)}>
        <Download data-icon="inline-start" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
    </Button>;
}
