import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FrameParts = { icon: ReactNode; title: ReactNode; detail: ReactNode; meta?: ReactNode; actions: ReactNode };
type FrameProps = Omit<ComponentProps<'div'>, 'title'> & FrameParts;

export function SkillRowFrame({ icon, title, detail, meta, actions, className, ...props }: FrameProps) {
  return (
    <div {...props} data-build-root className={cn('group flex min-h-[106px] min-w-0 flex-row items-center justify-between rounded-xl border-b border-black/5 px-3 py-3.5 transition-colors hover:bg-black/5 dark:border-white/5 dark:hover:bg-white/5', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-4 overflow-hidden pr-4">
        <div data-build-part="icon" className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/5 bg-black/5 text-2xl dark:border-white/10 dark:bg-white/5">{icon}</div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div data-build-part="title" className="mb-1 flex h-5 w-fit max-w-full items-center gap-2">{title}</div>
          <div data-build-part="detail" className="line-clamp-1 min-h-[23px] w-fit max-w-full pr-6 text-sm leading-relaxed text-muted-foreground">{detail}</div>
          <div data-build-part="meta" className="mt-1 flex h-5 min-w-0 max-w-full items-center gap-2 text-tiny text-foreground/55">{meta}</div>
        </div>
      </div>
      <div data-build-part="actions" className="flex shrink-0 items-center gap-6" onClick={(event) => event.stopPropagation()}>{actions}</div>
    </div>
  );
}

export function ChannelGroupFrame({ icon, title, detail, meta, actions, children, className, ...props }: FrameProps) {
  return (
    <div {...props} data-build-root className={cn('min-w-0 rounded-2xl border border-black/10 bg-transparent p-4 dark:border-white/10', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div data-build-part="icon" className="flex size-10 shrink-0 items-center justify-center rounded-full border border-black/5 bg-black/5 text-foreground shadow-sm dark:border-white/10 dark:bg-white/5">{icon}</div>
          <div className="min-w-0">
            <div data-build-part="title" className="w-fit max-w-full">{title}</div>
            <div data-build-part="detail" className="w-fit max-w-full">{detail}</div>
            {meta && <div data-build-part="meta">{meta}</div>}
          </div>
        </div>
        <div data-build-part="actions" className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      <div data-build-part="body" data-build-shape="box" className="space-y-2 rounded-xl">{children}</div>
    </div>
  );
}

export function ScheduledRowFrame({ icon, title, detail, meta, actions, className, ...props }: FrameProps) {
  return (
    <div {...props} data-build-root className={cn('group grid min-h-[85px] w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors', className)}>
      <span data-build-part="icon" className="mt-1 flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="min-w-0">
        <span data-build-part="title" className="flex min-h-5 min-w-0 items-baseline gap-2">{title}</span>
        <span data-build-part="detail" className="mt-0.5 block min-h-5 w-fit max-w-full truncate text-meta leading-5 text-muted-foreground">{detail}</span>
        <span data-build-part="meta" className="mt-0.5 block min-h-4 w-fit max-w-full truncate text-xs leading-4 text-muted-foreground/80">{meta}</span>
      </span>
      <span data-build-part="actions" className="flex min-h-8 shrink-0 items-center gap-1 pl-2" onClick={(event) => event.stopPropagation()}>{actions}</span>
    </div>
  );
}

export function SkillStructureRow() {
  return <SkillRowFrame aria-hidden="true" icon={null} title={<span className="block h-5 w-40" />} detail={<span className="block h-[23px] w-80 max-w-full" />} meta={<><span data-build-chip className="h-5 w-20 shrink-0 rounded-md" /><span className="h-4 w-56 max-w-full" /></>} actions={<><span className="h-5 w-8" /><span data-build-action className="h-5 w-8 rounded-full" /></>} />;
}

export function ChannelStructureRow() {
  return <ChannelGroupFrame aria-hidden="true" icon={null} title={<span className="block h-6 w-28" />} detail={<span className="block h-4 w-36" />} actions={<><span data-build-action className="h-8 w-28 rounded-full" /><span data-build-action className="size-7 rounded-md" /></>}><div className="h-12 rounded-xl" /></ChannelGroupFrame>;
}

export function ScheduledStructureRow() {
  return <ScheduledRowFrame aria-hidden="true" icon={null} title={<><span className="h-5 w-40 max-w-full" /><span data-build-status className="h-5 w-28 max-w-full" /></>} detail={<span className="block h-5 w-80 max-w-full" />} meta={<span className="block h-4 w-48 max-w-full" />} actions={<span data-build-action className="h-5 w-8 rounded-full" />} />;
}
