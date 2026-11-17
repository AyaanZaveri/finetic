"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function NavigatorRequestError({ error, busy, onRetry }: { error: Error; busy: boolean; onRetry: () => void }) {
    const setup = /api key|api_key|AI endpoint|AI provider|stable session/i.test(error.message)
        && /required|requires|missing|configured|expired|rejected|unsupported|check.*settings/i.test(error.message);
    const missing = /required|requires|missing|not configured/i.test(error.message);
    return <div role="alert" className="mx-2 flex min-w-0 flex-col items-start gap-3 rounded-xl border border-border px-4 py-3">
        <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">{setup ? missing ? "Set up Navigator" : "Check Navigator settings" : "Could not complete this request"}</p>
            <p className="break-words text-sm leading-relaxed text-muted-foreground">{setup
                ? missing ? "Add an API key for your selected provider in Settings to start chatting." : "Check the API key and provider in Settings, then send your message again."
                : error.message}</p>
        </div>
        {setup ? <Button asChild variant="outline" size="sm"><Link href="/settings/navigator">Open settings</Link></Button>
            : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRetry}>Try again</Button>}
    </div>;
}
