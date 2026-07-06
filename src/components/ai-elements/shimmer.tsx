import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ShimmerProps = ComponentProps<'span'> & {
  children?: ReactNode;
};

export function Shimmer({ children, className, ...props }: ShimmerProps) {
  return (
    <span
      className={cn(
        'inline-flex bg-[linear-gradient(110deg,hsl(var(--muted-foreground))_0%,hsl(var(--foreground))_45%,hsl(var(--muted-foreground))_80%)] bg-[length:200%_100%] bg-clip-text text-transparent motion-safe:animate-[ai-elements-shimmer_1.8s_linear_infinite]',
        className,
      )}
      data-testid="ai-element-shimmer"
      {...props}
    >
      {children}
    </span>
  );
}

export function ShimmerBlock({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'block rounded bg-[linear-gradient(110deg,hsl(var(--muted))_0%,hsl(var(--muted-foreground)/0.25)_45%,hsl(var(--muted))_80%)] bg-[length:200%_100%] motion-safe:animate-[ai-elements-shimmer_1.8s_linear_infinite]',
        className,
      )}
      aria-hidden
    />
  );
}
