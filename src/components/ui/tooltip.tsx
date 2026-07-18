import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"
import { useOverlayPortalContainer } from "@/components/ui/overlay-portal"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
    React.ComponentRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
    const container = useOverlayPortalContainer()
    return (
    <TooltipPrimitive.Portal container={container ?? undefined}>
    <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
            "z-[100] overflow-hidden rounded-[10px] border border-white/50 bg-popover/94 px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg backdrop-blur-[16px] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none dark:border-white/10",
            className
        )}
        {...props}
    />
    </TooltipPrimitive.Portal>
    )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
