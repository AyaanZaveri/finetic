"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { authenticateUser, finishStremioSignIn, startStremioSignIn } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/account-ui/input";
import { Label } from "@/components/account-ui/label";
import { Separator } from "@/components/account-ui/separator";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type StremioLink = Extract<Awaited<ReturnType<typeof startStremioSignIn>>, { success: true }>;

// Portalhop's SignInContent composition, with Stremio as the account provider.
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
    const id = useId();
    const pending = useRef(false);
    const pendingLink = useRef(false);
    const active = useRef(true);
    const popup = useRef<Window | null>(null);
    const success = useRef(onSuccess);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [linking, setLinking] = useState(false);
    const [link, setLink] = useState<StremioLink | null>(null);
    const [error, setError] = useState("");
    const busy = submitting || linking;

    useEffect(() => { success.current = onSuccess; }, [onSuccess]);

    useEffect(() => {
        active.current = true;
        return () => { active.current = false; popup.current?.close(); };
    }, []);

    useEffect(() => {
        if (!link) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const result = Date.now() >= link.expiresAt ? { status: "expired" } : await finishStremioSignIn(link.attempt);
                if (cancelled) return;
                if (result.status === "signed-in") {
                    popup.current?.close();
                    setPassword("");
                    toast.success("Signed in to Stremio");
                    success.current();
                    return;
                }
                if (result.status === "expired") {
                    pendingLink.current = false;
                    setLink(null);
                    setLinking(false);
                    setError("This sign-in link expired. Please try again.");
                    return;
                }
            } catch { /* A temporary connection failure can recover on the next poll. */ }
            if (!cancelled) timer = setTimeout(poll, 3000);
        };
        timer = setTimeout(poll, 1000);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [link]);

    async function signInWithStremio() {
        if (pending.current || pendingLink.current || busy) return;
        pendingLink.current = true;
        setLinking(true);
        setError("");
        // Open on the user gesture so the provider window survives popup blocking.
        popup.current = window.open("about:blank", "_blank");
        if (popup.current) popup.current.opener = null;
        try {
            const result = await startStremioSignIn();
            if (!active.current) return;
            if (!result.success) throw new Error(result.error);
            setLink(result);
            popup.current?.location.replace(result.link);
        } catch {
            popup.current?.close();
            if (active.current) {
                pendingLink.current = false;
                setLinking(false);
                setError("Couldn't open Stremio. Please try again or use your email and password.");
            }
        }
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (pending.current || linking) return;
        pending.current = true;
        setSubmitting(true);
        setError("");
        try {
            if (!await authenticateUser(email.trim(), password)) {
                setError("Couldn't sign in. Check your Stremio email and password and try again.");
                return;
            }
            setPassword("");
            toast.success("Signed in to Stremio");
            onSuccess();
        } catch {
            setError("Couldn't reach Stremio. Please try again.");
        } finally {
            pending.current = false;
            setSubmitting(false);
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <Button type="button" variant="outline" size="sm" className="h-10 w-full justify-center gap-2 bg-transparent" disabled={busy} onClick={signInWithStremio}>
                {linking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    // Official asset: github.com/Stremio/stremio-brand
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src="/logo/stremio.svg" alt="" aria-hidden="true" className="size-4 shrink-0" />}
                Sign in with Stremio
            </Button>
            {link && <div className="flex flex-col items-center gap-2 text-center text-sm">
                <p role="status" className="text-balance text-muted-foreground">Finish signing in in the Stremio window.</p>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                    <a draggable={false} href={link.link} target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">Open Stremio</a>
                    <button type="button" className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => { popup.current?.close(); pendingLink.current = false; setLink(null); setLinking(false); }} draggable={false}>Cancel</button>
                </div>
            </div>}
            <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or</span>
                <Separator className="flex-1" />
            </div>
            <form className="flex flex-col gap-3" onSubmit={submit} aria-busy={busy}>
                <div className="flex flex-col gap-2.5">
                    <Label htmlFor={`${id}-email`}>Email</Label>
                    <Input id={`${id}-email`} className="h-10" type="email" autoComplete="username" required maxLength={320}
                        value={email} disabled={busy} placeholder="you@example.com"
                        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
                        onChange={event => { setEmail(event.target.value); setError(""); }} />
                </div>
                <div className="flex flex-col gap-2.5">
                    <Label htmlFor={`${id}-password`}>Password</Label>
                    <Input id={`${id}-password`} className="h-10" type="password" autoComplete="current-password" required maxLength={4096}
                        value={password} disabled={busy} placeholder="Password"
                        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
                        onChange={event => { setPassword(event.target.value); setError(""); }} />
                </div>
                {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" size="sm" className="h-10 w-full justify-center gap-2" disabled={busy}>
                    {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                    Sign in
                </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground">
                {"Don't have an account?"}{" "}
                <a draggable={false} href="https://web.stremio.com/#/intro" target="_blank" rel="noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">Sign up</a>
            </p>
        </div>
    );
}
