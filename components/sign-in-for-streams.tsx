"use client";

import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useAccountAccess } from "@/contexts/account-context";

export function SignInForStreams() {
    const { requestSignIn } = useAccountAccess();
    return (
        <Empty className="flex-none gap-4 border border-solid border-border/60 bg-background/40 p-6 md:p-6">
            <div className="flex min-w-0 flex-col items-center gap-3">
                <EmptyMedia className="mb-0">
                    <img src="/logo/stremio.svg" alt="" aria-hidden="true" className="size-10" />
                </EmptyMedia>
                <EmptyHeader className="max-w-md gap-1">
                    <EmptyTitle>Connect your Stremio account</EmptyTitle>
                    <EmptyDescription>Sign in to load streams from your add-ons</EmptyDescription>
                </EmptyHeader>
            </div>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={requestSignIn}>
                <LogIn data-icon="inline-start" aria-hidden="true" />
                Sign in with Stremio
            </Button>
        </Empty>
    );
}
