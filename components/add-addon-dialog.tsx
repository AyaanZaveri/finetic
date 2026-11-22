"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowUpRight, ExternalLink, Link2, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { installAddon, previewAddon } from "@/app/actions/addons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/account-ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/account-ui/drawer";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AddonPreviewCard } from "@/components/addon-preview-card";
import { useStreamQueries } from "@/components/stream-query-provider";
import surface from "@/components/account-ui/surface.module.css";
import browseLink from "./browse-addon-link.module.css";
import previewStyle from "./addon-preview.module.css";

type Preview = NonNullable<Awaited<ReturnType<typeof previewAddon>>["addon"]>;

function isManifestLink(value: string) {
    try {
        const url = new URL(value.trim().replace(/^stremio:\/\//iu, "https://"));
        return ["http:", "https:"].includes(url.protocol) && /\/manifest\.json$/u.test(url.pathname);
    } catch { return false; }
}

export function AddAddonDialog() {
    const router = useRouter();
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const query = window.matchMedia("(max-width: 639px)");
        const update = () => setIsMobile(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    const queries = useStreamQueries();
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const request = useRef(0);
    const submitting = useRef(false);
    const [open, setOpen] = useState(false);
    const [link, setLink] = useState("");
    const [preview, setPreview] = useState<Preview | null>(null);
    const [configureUrl, setConfigureUrl] = useState<string | null>(null);
    const [configurationRequired, setConfigurationRequired] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const [lookupPending, setLookupPending] = useState(false);

    const review = useCallback(async (value: string, currentRequest: number) => {
        try {
            const result = await previewAddon(value);
            if (request.current !== currentRequest) return;
            if (result.error) { setError(result.error); return; }
            setPreview(result.addon);
            setConfigureUrl(result.configureUrl);
            setConfigurationRequired(result.configurationRequired);
        } catch {
            if (request.current === currentRequest) setError("Could not load this addon. Please try again.");
        }
    }, []);

    useEffect(() => {
        setLookupPending(false);
        if (!open || !isManifestLink(link)) return;
        const currentRequest = ++request.current;
        const timer = setTimeout(() => {
            if (request.current !== currentRequest || submitting.current) return;
            setLookupPending(true);
            void review(link, currentRequest).finally(() => {
                if (request.current === currentRequest) setLookupPending(false);
            });
        }, 600);
        return () => {
            clearTimeout(timer);
            if (request.current === currentRequest) request.current++;
        };
    }, [link, open, review]);

    function changeOpen(value: boolean) {
        setOpen(value);
        if (!value) {
            request.current++;
            setLink("");
            setPreview(null);
            setConfigureUrl(null);
            setConfigurationRequired(false);
            setError(null);
            setLookupPending(false);
        }
    }

    async function openFromClipboard() {
        changeOpen(true);
        const currentRequest = ++request.current;
        try {
            const value = (await navigator.clipboard.readText()).trim();
            if (request.current === currentRequest && !submitting.current && isManifestLink(value)) {
                setLink(value);
            }
        } catch { /* Clipboard access is optional. The link field stays ready for manual paste. */ }
    }

    useEffect(() => () => { request.current++; }, []);

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting.current || lookupPending || !link.trim() || configurationRequired) return;
        submitting.current = true;
        const currentRequest = ++request.current;
        setError(null);
        startTransition(async () => {
            try {
                if (preview) {
                    const result = await installAddon(link, preview.id);
                    if (result.error) {
                        if (request.current === currentRequest) setError(result.error);
                        return;
                    }
                    queries?.invalidate();
                    toast.success(`${preview.name} installed`);
                    changeOpen(false);
                    router.refresh();
                } else {
                    await review(link, currentRequest);
                }
            } catch {
                if (request.current === currentRequest) setError("Could not add this addon. Please try again.");
            } finally {
                submitting.current = false;
            }
        });
    }


    const Modal = isMobile ? Drawer : Dialog;
    const ModalContent = isMobile ? DrawerContent : DialogContent;
    const ModalHeader = isMobile ? DrawerHeader : DialogHeader;
    const ModalTitle = isMobile ? DrawerTitle : DialogTitle;
    const ModalDescription = isMobile ? DrawerDescription : DialogDescription;

    const browseAction = (
        <Button asChild variant={isMobile ? "link" : "outline"} size={isMobile ? "default" : "sm"}>
            <a draggable={false} className={browseLink.link} href="https://stremio-addons.net/" target="_blank" rel="noopener noreferrer" aria-label="Browse Stremio Addons (opens in a new tab)">
                <Image src="/images/stremio-addons.ico" width={16} height={16} unoptimized alt="" data-icon="inline-start" />
                <span className="inline-flex items-center">
                    Browse addons
                    <span className={browseLink.arrow} aria-hidden="true">
                        <ArrowUpRight className="size-4" strokeWidth={2} absoluteStrokeWidth />
                    </span>
                </span>
            </a>
        </Button>
    );
    const primaryAction = configurationRequired && configureUrl ? (
        <Button asChild size={isMobile ? "default" : "sm"} className={isMobile ? "w-full" : undefined}>
            <a draggable={false} href={configureUrl} target="_blank" rel="noopener noreferrer">Configure addon<ExternalLink data-icon="inline-end" strokeWidth={1.75} aria-hidden="true" /></a>
        </Button>
    ) : (
        <Button type="submit" size={isMobile ? "default" : "sm"} className={isMobile ? "w-full" : undefined} aria-busy={pending || lookupPending} disabled={pending || lookupPending || !link.trim() || configurationRequired}>
            {pending || lookupPending ? <>
                <Loader2 data-icon="inline-start" aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                <span className={previewStyle.loadingText}>{pending && preview ? "Installing" : "Loading"}</span>
            </> : (preview ? "Install addon" : "Review addon")}
        </Button>
    );

    return (
        <>
            <Button ref={trigger} size="sm" className="size-[var(--addon-search-height,2.75rem)] rounded-xl p-0 sm:h-9 sm:w-auto sm:rounded-full sm:px-3" disabled={pending} aria-label="Add addon" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-dialog` : undefined} onClick={() => { void openFromClipboard(); }}>
                <Plus data-icon="inline-start" aria-hidden="true" /><span className="hidden sm:inline">Add addon</span>
            </Button>
            <Modal open={open} onOpenChange={changeOpen} {...(isMobile ? { showSwipeHandle: true } : {})}>
                <ModalContent id={`${id}-dialog`} overlayClassName={surface.addonBackdrop} className={isMobile
                    ? `${surface.surface} [--drawer-inset:0.5rem] after:hidden`
                    : `${surface.surface} max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain gap-7 p-6 sm:max-w-[560px]`} finalFocus={trigger}>
                    <ModalHeader className={isMobile ? "relative p-6 pb-0" : "pr-8"}>
                        <ModalTitle className={isMobile ? "mx-10" : undefined}>Add addon</ModalTitle>
                        {isMobile && <Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4 size-11" aria-label="Close" onClick={() => changeOpen(false)}>
                            <X aria-hidden="true" />
                        </Button>}
                        <ModalDescription className="sr-only">Install an addon from its Stremio link.</ModalDescription>
                    </ModalHeader>
                    <form onSubmit={submit} className={`flex min-w-0 flex-col gap-6 ${isMobile ? "min-h-0 overflow-y-auto overscroll-contain p-6" : ""}`} aria-busy={pending || lookupPending}>
                        <FieldGroup>
                            <Field data-invalid={!!error}>
                                <FieldLabel htmlFor={`${id}-link`} className="sr-only">Addon link</FieldLabel>
                                <InputGroup data-disabled={pending}>
                                    <InputGroupInput id={`${id}-link`} type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
                                        placeholder="https://example.com/manifest.json" required maxLength={8192} value={link} disabled={pending}
                                        aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
                                        onChange={event => {
                                            request.current++;
                                            setLookupPending(false);
                                            setLink(event.target.value);
                                            setPreview(null);
                                            setConfigurationRequired(false);
                                            setConfigureUrl(null);
                                            setError(null);
                                        }} />
                                    <InputGroupAddon align="inline-start" aria-hidden="true">
                                        <Link2 />
                                    </InputGroupAddon>
                                </InputGroup>
                                {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
                            </Field>
                        </FieldGroup>
                        {preview && <AddonPreviewCard addon={preview}>
                            {configurationRequired && <p className="text-sm leading-[1.5] text-muted-foreground">
                                Configure this addon first, then paste its configured link here.
                            </p>}
                        </AddonPreviewCard>}
                        {isMobile ? (
                            <div className="flex flex-col items-center gap-2">
                                {primaryAction}
                                {browseAction}
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                {browseAction}
                                <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={() => changeOpen(false)}>Cancel</Button>
                                    {primaryAction}
                                </div>
                            </div>
                        )}
                    </form>
                </ModalContent>
            </Modal>
        </>
    );
}
