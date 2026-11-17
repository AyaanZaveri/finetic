"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function PersonRetryButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return <Button variant="secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending ? "Trying again…" : "Try again"}
    </Button>;
}
