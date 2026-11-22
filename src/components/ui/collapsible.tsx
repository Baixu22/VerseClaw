import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type CollapsibleProps = {
  variant?: 'card' | 'plain';
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  buttonTestId?: string;
  contentId?: string;
  contentTestId?: string;
  'data-testid'?: string;
};

export function Collapsible({
  variant = 'card',
  title,
  subtitle,
  leading,
  trailing,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  headerClassName,
  contentClassName,
  buttonTestId,
  contentId,
  contentTestId,
  'data-testid': testId,
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = useCallback((next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange, open]);

  return (
    <div className={cn(variant === 'card' && 'rounded-md border border-border bg-surface-modal', className)} data-testid={testId}>
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-center gap-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          variant === 'card'
            ? 'px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10'
            : 'rounded-sm px-1 py-1 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
          headerClassName,
        )}
        aria-expanded={isOpen}
        aria-controls={isOpen ? contentId : undefined}
        onClick={() => setOpen(!isOpen)}
        data-testid={buttonTestId}
      >
        {leading ? <span className="shrink-0 text-muted-foreground">{leading}</span> : null}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium text-foreground', variant === 'card' ? 'text-sm' : 'text-[13px]')}>{title}</span>
          {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
        </span>
        {trailing ? <span className="shrink-0">{trailing}</span> : null}
        <ChevronDown aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', variant === 'plain' && !isOpen && '-rotate-90', variant === 'card' && isOpen && 'rotate-180')} />
      </button>
      {isOpen ? (
        <div id={contentId} data-testid={contentTestId} className={cn(variant === 'card' ? 'border-t border-border px-3 py-3' : 'ml-3 border-l border-border/60 py-1 pl-3 pr-1', contentClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
