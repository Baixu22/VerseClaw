import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full resize-y rounded-lg border border-input bg-surface-input px-3 py-2 text-[13px] leading-5 ring-offset-background transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none',
        className
      )}
      ref={ref}
      {...props}
    />
  );
})
Textarea.displayName = 'Textarea';

export { Textarea };
