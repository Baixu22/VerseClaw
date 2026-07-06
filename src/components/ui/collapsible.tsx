import { useCallback, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type CollapsibleProps = {
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
  'data-testid'?: string;
};

export function Collapsible({
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
  'data-testid': testId,
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = useCallback((next: boolean) => {
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange, open]);

  return (
    <div className={cn('rounded-md border border-border bg-surface-modal', className)} data-testid={testId}>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10',
          headerClassName,
        )}
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
      >
        {leading ? <span className="shrink-0 text-muted-foreground">{leading}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
        </span>
        {trailing ? <span className="shrink-0">{trailing}</span> : null}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen ? (
        <div className={cn('border-t border-border px-3 py-3', contentClassName)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
