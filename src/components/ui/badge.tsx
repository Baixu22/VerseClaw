/* eslint-disable react-refresh/only-export-components */
/**
 * Badge Component
 * Based on shadcn/ui badge
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium leading-4 tracking-normal transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-black/5 text-foreground dark:bg-white/10',
        secondary:
          'border-transparent bg-material-control text-muted-foreground',
        destructive:
          'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400',
        outline: 'border-border bg-transparent text-muted-foreground',
        success:
          'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400',
        warning:
          'border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
