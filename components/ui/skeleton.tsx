import { cn } from "@/lib/utils"

function Skeleton({ className, animated = true, ...props }: React.ComponentProps<"div"> & { animated?: boolean }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("bg-accent rounded-md", animated && "animate-pulse motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
