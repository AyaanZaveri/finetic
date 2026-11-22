"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { Check, Copy, Link2, Loader2, X } from "lucide-react";
import { AddonPreviewCard } from "@/components/addon-preview-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/account-ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/account-ui/drawer";
import surface from "@/components/account-ui/surface.module.css";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { AddonListItem } from "@/lib/addons";
import previewStyle from "./addon-preview.module.css";

export const ADDON_COPY_CONFIRMATION_MS = 1500;

export type AddonShareState =
    | { kind: "loading" }
    | { kind: "unavailable"; message: string }
    | { kind: "ready" | "copying" | "copied"; url: string }
    | { kind: "copy-error"; url: string; message: string };

export function AddonShareContent({ addon, state, onCopy, open, onOpenChange, finalFocus }: {
    addon: AddonListItem;
    state: AddonShareState;
    onCopy(): void;
    open: boolean;
    onOpenChange(_open: boolean): void;
    finalFocus: RefObject<HTMLButtonElement | null>;
}) {
    const id = useId();
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 639px)");
        const update = () => setIsMobile(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);

    const Modal = isMobile ? Drawer : Dialog;
    const Content = isMobile ? DrawerContent : DialogContent;
    const Header = isMobile ? DrawerHeader : DialogHeader;
    const Title = isMobile ? DrawerTitle : DialogTitle;
    const Description = isMobile ? DrawerDescription : DialogDescription;
    const loading = state.kind === "loading";
    const copying = state.kind === "copying";
    const copied = state.kind === "copied";
    const warningId = addon.configurable ? `${id}-warning` : undefined;
    const errorId = "message" in state ? `${id}-error` : undefined;

    return <Modal open={open} onOpenChange={onOpenChange} {...(isMobile ? { showSwipeHandle: true } : {})}>
        <Content overlayClassName={surface.addonBackdrop} className={isMobile
            ? `${surface.surface} [--drawer-inset:0.5rem] after:hidden`
            : `${surface.surface} max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain gap-7 p-6 sm:max-w-[560px]`}
            finalFocus={finalFocus}>
            <Header className={isMobile ? "relative p-6 pb-0" : "pr-8"}>
                <Title className={isMobile ? "mx-10" : undefined}>Share addon</Title>
                {isMobile && <Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4 size-11" aria-label="Close" onClick={() => onOpenChange(false)}>
                    <X aria-hidden="true" />
                </Button>}
                <Description className="sr-only">Copy the manifest link to install this addon in Stremio.</Description>
            </Header>
            <div className={`flex min-w-0 flex-col gap-6 ${isMobile ? "min-h-0 overflow-y-auto overscroll-contain p-6" : ""}`}>
                <AddonPreviewCard addon={addon} />
                <div className="flex min-w-0 flex-col gap-4">
                    {"url" in state && <Field data-invalid={state.kind === "copy-error"}>
                        <FieldLabel htmlFor={id} className="sr-only">Addon link</FieldLabel>
                        <InputGroup>
                            <InputGroupInput id={id} value={state.url} readOnly onFocus={event => event.currentTarget.select()}
                                aria-describedby={[warningId, errorId].filter(Boolean).join(" ") || undefined} />
                            <InputGroupAddon align="inline-start" aria-hidden="true"><Link2 /></InputGroupAddon>
                        </InputGroup>
                        {warningId && <FieldDescription id={warningId}>
                            This link may include private addon settings
                        </FieldDescription>}
                        {state.kind === "copy-error" && <FieldError id={errorId}>{state.message}</FieldError>}
                    </Field>}
                    {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                        <span className={previewStyle.loadingText}>Loading addon link…</span>
                    </p>}
                    {state.kind === "unavailable" && <FieldError id={errorId}>{state.message}</FieldError>}
                    <div className={isMobile ? "flex flex-col" : "flex justify-end"}>
                        <Button type="button" size={isMobile ? "default" : "sm"} disabled={!("url" in state)}
                            aria-disabled={copying || undefined} onClick={onCopy}>
                            <span className={previewStyle.copyIcons} data-copied={copied || undefined} aria-hidden="true">
                                <Copy />
                                <Check />
                            </span>
                            Copy link
                        </Button>
                        <span className="sr-only" role="status">{copied ? "Addon link copied" : ""}</span>
                    </div>
                </div>
            </div>
        </Content>
    </Modal>;
}
