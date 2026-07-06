import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type AiElementCardProps = {
  icon?: ReactNode;
  label?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  'data-testid'?: string;
};

export function AiElementCard({
  icon,
  label,
  title,
  subtitle,
  children,
  className,
  bodyClassName,
  'data-testid': testId,
}: AiElementCardProps) {
  return (
    <section
      className={cn('w-full rounded-lg border border-border bg-surface-modal/80 px-4 py-3 shadow-sm', className)}
      data-testid={testId ?? 'ai-element-card'}
    >
      {(label || title || subtitle || icon) ? (
        <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            {label ? (
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase text-muted-foreground/70">
                {icon}
                <span>{label}</span>
              </div>
            ) : null}
            {title ? <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3> : null}
            {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export type AiElementStatus = 'passed' | 'failed' | 'skipped' | 'running' | 'complete' | 'active' | 'pending' | 'blocked';

const STATUS_CLASS: Record<AiElementStatus, string> = {
  passed: 'bg-green-500',
  failed: 'bg-red-500',
  skipped: 'bg-muted-foreground/40',
  running: 'bg-blue-500',
  complete: 'bg-green-500',
  active: 'bg-blue-500',
  pending: 'bg-muted-foreground/35',
  blocked: 'bg-amber-500',
};

export function StatusDot({ status, className }: { status: AiElementStatus; className?: string }) {
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_CLASS[status], className)} aria-hidden />;
}

export function MetricPill({ label, value, tone = 'neutral' }: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info';
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-1 rounded-md border px-2 py-1 text-xs',
        tone === 'neutral' && 'border-border bg-surface-input text-muted-foreground',
        tone === 'success' && 'border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-400',
        tone === 'danger' && 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400',
        tone === 'warning' && 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'info' && 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400',
      )}
    >
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}
