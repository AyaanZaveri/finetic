"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// UI Arc's primary, secondary, ghost and danger treatments, adapted to the
// app's existing variants, Slot composition and original 3% press feedback.
const primary = "border-foreground bg-foreground text-background hover:opacity-[0.91] data-[pressed=true]:opacity-[0.84]";
const secondary = "border-border bg-[var(--surface)] text-foreground hover:bg-[var(--surface-muted)] hover:shadow-[var(--shadow-resting)] disabled:bg-[var(--surface-muted)] disabled:text-muted-foreground disabled:opacity-100";
const danger = "border-transparent bg-destructive/20 text-destructive hover:bg-destructive/30";

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap border border-transparent text-sm font-medium leading-[1.4] tracking-[var(--tracking-body)] outline-none touch-manipulation select-none [-webkit-tap-highlight-color:transparent] origin-center [transform-box:border-box] transition-[color,background-color,border-color,opacity,box-shadow,transform] duration-200 ease-in-out motion-safe:[transform:translateZ(0)_scale(1)] motion-safe:data-[pressed=true]:[transform:translateZ(0)_scale(0.97)] motion-reduce:transition-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[0.52] focus-visible:border-ring focus-visible:ring-ring/22 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: primary,
        primary,
        outline: secondary,
        secondary,
        "media-primary": "border-0 bg-foreground text-background shadow-xs hover:bg-foreground/90",
        "media-secondary": "border-0 bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "bg-transparent text-foreground hover:bg-[var(--surface-muted)] aria-expanded:bg-[var(--surface-muted)] disabled:opacity-100",
        destructive: danger,
        danger,
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 rounded-[12px] px-3",
        md: "h-11 rounded-[12px] px-4",
        xs: "h-7 gap-1 rounded-[10px] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-2 rounded-[12px] px-3",
        lg: "h-[50px] rounded-[14px] px-5",
        icon: "size-9 rounded-[12px] p-0",
        "icon-xs": "size-6 rounded-[8px] p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[10px] p-0",
        "icon-lg": "size-10 rounded-[12px] p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & {
  asChild?: boolean;
  loading?: boolean;
};

function Button({
  className, variant = "default", size = "default", asChild = false,
  loading = false, disabled, children, onClick, onPointerDown, onPointerUp,
  onPointerLeave, onPointerCancel, ...props
}: ButtonProps) {
  const [pressed, setPressed] = React.useState(false);
  const inert = disabled || loading || props["aria-disabled"] === true || props["aria-disabled"] === "true";
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      {...props}
      disabled={disabled}
      data-pressed={pressed && !inert ? "true" : undefined}
      aria-busy={loading || props["aria-busy"] || undefined}
      aria-disabled={loading || props["aria-disabled"] || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      onPointerDown={event => {
        onPointerDown?.(event);
        // Popup triggers can prevent native focus changes on pointerdown.
        // Their visual press feedback still follows the same rule as every button.
        if (event.button === 0 && !inert) setPressed(true);
      }}
      onPointerUp={event => { setPressed(false); onPointerUp?.(event); }}
      onPointerLeave={event => { setPressed(false); onPointerLeave?.(event); }}
      onPointerCancel={event => { setPressed(false); onPointerCancel?.(event); }}
      onClick={event => {
        if (inert) { event.preventDefault(); return; }
        onClick?.(event);
      }}
    >
      {asChild ? children : loading ? <>
        <Loader2 aria-hidden="true" className="absolute inset-0 m-auto animate-spin motion-reduce:animate-none" />
        <span className="inline-flex items-center justify-center gap-[inherit] opacity-0">{children}</span>
      </> : children}
    </Comp>
  );
}

export { Button, buttonVariants, type ButtonProps };
