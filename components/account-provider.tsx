"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountContext } from "@/contexts/account-context";
import { LoginForm } from "@/components/login-form";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/account-ui/drawer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/account-ui/dialog";
import styles from "@/components/account-ui/surface.module.css";

function SignInQuery({ requestSignIn }: { requestSignIn: () => void }) {
    const params = useSearchParams();
    const requested = params.get("signIn") === "1";
    useEffect(() => {
        if (!requested) return;
        requestSignIn();
        const url = new URL(window.location.href);
        url.searchParams.delete("signIn");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }, [requested, requestSignIn]);
    return null;
}

// Same breakpoint and presentation switch as Portalhop's AuthDialog.
function useIsMobile() {
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 639px)");
        const update = () => setIsMobile(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return isMobile;
}

export function AccountProvider({ authenticated, children }: { authenticated: boolean; children: ReactNode }) {
    const router = useRouter();
    const isMobile = useIsMobile();
    const [open, setOpen] = useState(false);
    const returnFocus = useRef<HTMLElement | null>(null);
    const requestSignIn = useCallback(() => {
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
    }, []);
    const value = useMemo(() => ({ authenticated, requestSignIn }), [authenticated, requestSignIn]);

    return (
        <AccountContext.Provider value={value}>
            {children}
            {!authenticated && <>
                <Suspense fallback={null}><SignInQuery requestSignIn={requestSignIn} /></Suspense>
                {isMobile ? (
                    <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
                        <DrawerContent className={`${styles.surface} [--drawer-inset:0.5rem] after:hidden`} finalFocus={returnFocus}>
                            <DrawerHeader className="p-6 pb-0">
                                <DrawerTitle>Sign in</DrawerTitle>
                                <DrawerDescription>Sign in through Stremio or enter your email and password</DrawerDescription>
                            </DrawerHeader>
                            <div className="p-6">
                                <LoginForm onSuccess={() => { setOpen(false); router.refresh(); }} />
                            </div>
                        </DrawerContent>
                    </Drawer>
                ) : (
                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogContent className={`${styles.surface} max-h-[calc(100dvh-2rem)] overflow-y-auto gap-6 p-6 sm:max-w-[440px]`} finalFocus={returnFocus}>
                            <DialogHeader className="pr-8">
                                <DialogTitle>Sign in</DialogTitle>
                                <DialogDescription>Sign in through Stremio or enter your email and password</DialogDescription>
                            </DialogHeader>
                            <LoginForm onSuccess={() => { setOpen(false); router.refresh(); }} />
                        </DialogContent>
                    </Dialog>
                )}
            </>}
        </AccountContext.Provider>
    );
}
