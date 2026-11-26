"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  onFocus,
  onPointerMove,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      onFocus={event => {
        onFocus?.(event)
        const trigger = event.currentTarget
        const modality = trigger.ownerDocument.documentElement.dataset.inputModality
        // A tap can focus after pointerup, when Radix's press guard has reset.
        if (modality === "pointer" || (modality !== "keyboard" && !trigger.matches(":focus-visible"))) {
          event.preventDefault()
        }
      }}
      onPointerMove={event => {
        onPointerMove?.(event)
        const view = event.currentTarget.ownerDocument.defaultView
        // Radix already ignores native touch moves. Skip emulated hover too.
        if (event.pointerType !== "touch" && !view?.matchMedia("(any-hover: hover)").matches) {
          event.preventDefault()
        }
      }}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  container,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  container?: React.ComponentProps<typeof TooltipPrimitive.Portal>["container"]
}) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0 data-[state=instant-open]:zoom-in-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 rounded-md px-3 py-1.5 text-xs font-medium bg-foreground text-background z-[var(--layer-tooltip)] w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin)",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="size-2.5 rotate-45 rounded-[2px] bg-foreground fill-foreground z-[var(--layer-tooltip)] translate-y-[calc(-50%_-_2px)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
