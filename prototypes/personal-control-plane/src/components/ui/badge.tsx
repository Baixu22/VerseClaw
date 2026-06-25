/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-tiny font-medium transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success:
          'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400',
        warning:
          'border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
        destructive:
          'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400',
        info:
          'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400',
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
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
