"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { desktopBridge, type UpdateStatus } from "@/lib/desktop/bridge";

/** Keep updates reachable before sign-in as well as from Settings → About. */
export function DesktopUpdateButton() {
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    useEffect(() => {
        const bridge = desktopBridge();
        if (!bridge?.capabilities?.updates) return;
        const unsubscribe = bridge.subscribe(message => { if (message.type === "update-status") setStatus(message); });
        bridge.send({ type: "update-status" });
        return unsubscribe;
    }, []);
    if (!status?.available || !["available", "ready"].includes(status.state)) return null;
    const ready = status.state === "ready";
    return <Button variant="outline" className="max-sm:size-11 max-sm:p-0"
        aria-label={ready ? "Update ready. Restart to update." : "Update available. Open the updater to download."} title={ready ? "Restart to update" : "Update available"}
        onClick={() => desktopBridge()?.send({ type: "update-check" })}>
        <Download data-icon="inline-start" aria-hidden="true" />
        <span className="hidden sm:inline">{ready ? "Restart to update" : "Update available"}</span>
    </Button>;
}
