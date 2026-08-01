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
>(({ className, sideOffset = 8, ...props }, ref) => {
    const container = useOverlayPortalContainer()
    return (
    <TooltipPrimitive.Portal container={container ?? undefined}>
    <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
            "z-[100] inline-flex min-h-7 items-center overflow-hidden rounded-[12.5px] border-[0.5px] border-white/[0.082] bg-[#2d2d2d] px-2 py-1 text-[13px] font-normal leading-[18.5px] text-white shadow-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 motion-reduce:animate-none",
            className
        )}
        {...props}
    />
    </TooltipPrimitive.Portal>
    )
})
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
