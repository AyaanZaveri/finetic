"use client";

import { useRef, useState, type ReactElement } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/account-ui/drawer";
import { useActionMenuHighlight } from "@/components/use-action-menu-highlight";
import accountSurface from "@/components/account-ui/surface.module.css";
import glass from "@/components/arc/floating-surface.module.css";

export function StreamActionsMenu({ label, url, downloadUrl, filename, children, portalContainer }: {
  label: string; url?: string; downloadUrl?: string; filename?: string; children: ReactElement;
  portalContainer?: HTMLElement | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { groupProps, highlightElement, resetHighlight } = useActionMenuHighlight();
  const returnFocus = useRef<HTMLElement | null>(null);
  const touchInvocation = useRef(false);
  const suppressClick = useRef(false);

  const copy = async () => {
    setDrawerOpen(false);
    try {
      if (!url) return;
      await navigator.clipboard.writeText(url);
      toast.success("Stream link copied");
    } catch {
      toast.error("Could not copy stream link");
    }
  };
  const download = () => {
    if (!downloadUrl) return;
    setDrawerOpen(false);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename || "";
    link.target = "_blank";
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (!url) return children;

  return <>
    <ContextMenu open={menuOpen} onOpenChange={open => {
      resetHighlight();
      if (open && (touchInvocation.current || window.matchMedia("(max-width: 639px)").matches)) {
        suppressClick.current = true;
        setDrawerOpen(true);
        return;
      }
      setMenuOpen(open);
    }}>
      <ContextMenuTrigger asChild
        onPointerDownCapture={event => {
          suppressClick.current = false;
          touchInvocation.current = event.pointerType === "touch" || event.pointerType === "pen";
          returnFocus.current = event.currentTarget;
        }}
        onContextMenu={event => { returnFocus.current = event.currentTarget; }}
        onClickCapture={event => {
          if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
        }}
        onKeyDown={event => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault(); event.stopPropagation();
          touchInvocation.current = false;
          returnFocus.current = event.currentTarget;
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: rect.top + 12 }));
        }}>{children}</ContextMenuTrigger>
      <ContextMenuContent portalContainer={portalContainer} data-base-ui-swipe-ignore="" aria-label={`Actions for ${label}`} collisionPadding={12} className={`w-64 ${glass.surface}`}
        onCloseAutoFocus={event => {
          if (!returnFocus.current?.isConnected) return;
          event.preventDefault(); returnFocus.current.focus({ preventScroll: true });
        }}>
        <ContextMenuGroup {...groupProps}>
          {highlightElement}
          {downloadUrl && (
            <ContextMenuItem data-card-menu-item="" className="focus:bg-transparent" onSelect={download} textValue="Download">
              <Download aria-hidden="true" />Download
            </ContextMenuItem>
          )}
          <ContextMenuItem data-card-menu-item="" className="focus:bg-transparent" onSelect={() => void copy()} textValue="Copy stream">
            <Copy aria-hidden="true" />Copy stream
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
    <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} showSwipeHandle>
      <DrawerContent className={`${accountSurface.surface} [--drawer-inset:0.5rem] after:hidden`} finalFocus={returnFocus}>
        <DrawerHeader><DrawerTitle>Stream actions</DrawerTitle><DrawerDescription>Choose an action</DrawerDescription></DrawerHeader>
        <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain p-3 pb-2">
          {downloadUrl && <Button type="button" variant="ghost" className="min-h-12 w-full justify-start" onClick={download}><Download data-icon="inline-start" aria-hidden="true" />Download</Button>}
          <Button type="button" variant="ghost" className="min-h-12 w-full justify-start" onClick={() => void copy()}><Copy data-icon="inline-start" aria-hidden="true" />Copy stream</Button>
        </div>
      </DrawerContent>
    </Drawer>
  </>;
}
