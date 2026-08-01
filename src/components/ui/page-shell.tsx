import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function MaterialSurface({
  level = 'panel',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  level?: 'sidebar' | 'panel' | 'elevated' | 'control';
}) {
  const levels = {
    sidebar: 'bg-material-sidebar',
    panel: 'bg-material-panel',
    elevated: 'bg-material-elevated shadow-lg',
    control: 'bg-material-control',
  } as const;

  return (
    <div
      className={cn('border border-border', levels[level], className)}
      {...props}
    />
  );
}

export function PageShell({
  title,
  description,
  actions,
  children,
  className,
  testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn('mx-auto flex min-h-full w-full max-w-[1180px] flex-col gap-4', className)}>
      <header className="flex min-h-10 shrink-0 items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-normal leading-[34px] tracking-normal text-foreground">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function CollectionPageShell(props: Parameters<typeof PageShell>[0]) {
  return <PageShell {...props} className={cn('max-w-[1120px]', props.className)} />;
}

export function WorkbenchPageShell(props: Parameters<typeof PageShell>[0]) {
  return <PageShell {...props} className={cn('max-w-none', props.className)} />;
}

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden border-y border-border bg-material-panel">
      <header className="border-b border-black/8 px-4 py-3 dark:border-white/10">
        <h2 className="text-[15px] font-medium leading-5 tracking-normal">{title}</h2>
        {description ? <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{description}</p> : null}
      </header>
      <div className="divide-y divide-black/8 dark:divide-white/10">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  control,
}: {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-5 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-5 text-foreground">{title}</div>
        {description ? <div className="text-xs leading-4 text-muted-foreground">{description}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
