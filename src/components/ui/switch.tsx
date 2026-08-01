/**
 * Switch Component
 * Based on shadcn/ui switch
 */
import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full border border-black/10 transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=unchecked]:bg-black/10 dark:border-white/10 dark:data-[state=unchecked]:bg-white/15 motion-reduce:transition-none',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-4 w-4 rounded-full shadow-sm ring-0 transition-[transform,background-color] duration-150 data-[state=checked]:translate-x-[13px] data-[state=checked]:bg-background data-[state=unchecked]:translate-x-[1px] data-[state=unchecked]:bg-white dark:data-[state=unchecked]:bg-neutral-200 motion-reduce:transition-none'
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
