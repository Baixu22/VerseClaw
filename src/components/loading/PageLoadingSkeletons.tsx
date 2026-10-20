import type { ComponentProps, ReactNode } from 'react';
import { SketchBlock } from '@/components/loading/StructuralSketch';
import { cn } from '@/lib/utils';

function SkeletonLine({ className }: { className?: string }) {
  return <SketchBlock className={cn('h-3 rounded-full', className)} />;
}

function SkeletonCard({ className, children, ...props }: ComponentProps<'div'> & { children: ReactNode }) {
  return (
    <div {...props} className={cn('rounded-xl border border-border/60 bg-surface-modal p-5', className)}>
      {children}
    </div>
  );
}

export function SkillsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <div data-testid="skills-loading-skeleton" className={cn('space-y-4', embedded ? 'min-h-64' : 'min-h-[calc(100vh-10rem)]')}>
      <div data-structural-region data-reveal-order="0" className="flex gap-2 border-b border-border/60 pb-3">
        {[0, 1, 2].map((item) => <SketchBlock key={item} className="h-8 w-24 rounded-full" />)}
      </div>
      {[0, 1, 2, 3].map((item) => (
        <SkeletonCard
          key={item}
          data-structural-region
          data-reveal-order={item < 2 ? 1 : 2}
          className="min-h-[104px]"
        >
          <div className="flex items-start gap-4">
            <SketchBlock className="size-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <SkeletonLine className="w-2/5" />
              <SkeletonLine className="mt-3 w-4/5" />
              <div className="mt-3 flex gap-2">
                <SketchBlock className="h-6 w-16 rounded-full" />
                <SketchBlock className="h-6 w-24 rounded-full" />
              </div>
            </div>
            <SketchBlock className="h-8 w-20 shrink-0 rounded-lg" />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

export function ChannelsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  return (
    <div
      data-testid="channels-loading-skeleton"
      className={cn('grid gap-4 md:grid-cols-2', embedded ? 'min-h-64' : 'min-h-[calc(100vh-10rem)]')}
    >
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <SkeletonCard
          key={item}
          data-structural-region
          data-reveal-order={item < 2 ? 0 : item < 4 ? 1 : 2}
          className="min-h-[168px]"
        >
          <div className="flex items-start justify-between gap-4">
            <SketchBlock className="size-11 rounded-xl" />
            <SketchBlock className="h-6 w-16 rounded-full" />
          </div>
          <SkeletonLine className="mt-5 w-1/3" />
          <SkeletonLine className="mt-3 w-4/5" />
          <SkeletonLine className="mt-2 w-3/5" />
        </SkeletonCard>
      ))}
    </div>
  );
}

export function CronLoadingSkeleton() {
  return (
    <div data-testid="cron-loading-skeleton" className="space-y-3">
      <SkeletonCard data-structural-region data-reveal-order="0" className="min-h-[86px]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 gap-3">
            <SketchBlock className="h-9 flex-1 rounded-lg" />
            <SketchBlock className="h-9 w-36 rounded-lg" />
            <SketchBlock className="h-9 w-32 rounded-lg" />
          </div>
          <SketchBlock className="size-9 rounded-lg" />
        </div>
      </SkeletonCard>
      {[0, 1, 2, 3].map((item) => (
        <SkeletonCard
          key={item}
          data-structural-region
          data-reveal-order={item < 2 ? 1 : 2}
          className="min-h-[108px]"
        >
          <div className="flex items-start gap-4">
            <SketchBlock className="size-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SkeletonLine className="w-44" />
                <SketchBlock className="h-5 w-16 rounded-full" />
              </div>
              <SkeletonLine className="mt-3 w-3/5" />
              <div className="mt-3 flex gap-2">
                <SketchBlock className="h-6 w-24 rounded-full" />
                <SketchBlock className="h-6 w-20 rounded-full" />
              </div>
            </div>
            <SketchBlock className="h-8 w-20 shrink-0 rounded-lg" />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

export function ModelsUsageLoadingSkeleton() {
  return (
    <div data-testid="models-usage-loading-skeleton" className="space-y-5 rounded-2xl border border-border/60 bg-surface-modal p-5">
      <div data-structural-region data-reveal-order="0" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <SketchBlock className="h-8 w-28 rounded-lg" />
          <SketchBlock className="h-8 w-24 rounded-lg" />
        </div>
        <SkeletonLine className="w-28" />
      </div>
      <div data-structural-region data-reveal-order="1" className="flex h-52 items-end gap-3 rounded-xl border border-border/50 bg-surface-input/20 p-4">
        {[36, 58, 44, 72, 54, 66, 48, 78].map((height, index) => (
          <div key={index} className="flex h-full flex-1 items-end">
            <SketchBlock className={cn('w-full rounded-t-md', height > 65 ? 'h-4/5' : height > 50 ? 'h-3/5' : 'h-2/5')} />
          </div>
        ))}
      </div>
      <div data-structural-region data-reveal-order="2" className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-lg border border-border/50 p-3">
            <SkeletonLine className="w-1/2" />
            <SkeletonLine className="mt-2 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BillingUsageLoadingSkeleton() {
  return (
    <div data-testid="billing-usage-loading-skeleton" className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <SkeletonCard
            key={item}
            data-structural-region
            data-reveal-order={item < 2 ? 0 : 1}
            className="min-h-[116px]"
          >
            <SketchBlock className="size-8 rounded-lg" />
            <SkeletonLine className="mt-4 w-2/3" />
            <SketchBlock className="mt-3 h-6 w-1/2" />
          </SkeletonCard>
        ))}
      </div>
      <div data-structural-region data-reveal-order="2" className="h-72 rounded-xl border border-border/60 bg-surface-modal p-5">
        <SkeletonLine className="w-44" />
        <div className="mt-6 flex h-48 items-end gap-3">
          {[40, 64, 52, 76, 58, 70, 46].map((_, index) => (
            <div key={index} className="flex h-full flex-1 items-end">
              <SketchBlock className={cn('w-full rounded-t-md', index % 3 === 0 ? 'h-1/2' : index % 3 === 1 ? 'h-4/5' : 'h-3/5')} />
            </div>
          ))}
        </div>
      </div>
      <div data-structural-region data-reveal-order="2" className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((item) => (
          <SkeletonCard key={item} className="min-h-[220px]">
            <SkeletonLine className="w-1/3" />
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="mt-4 flex items-center gap-3">
                <SketchBlock className="h-3 flex-1 rounded-full" />
                <SketchBlock className="h-3 w-16 rounded-full" />
                <SketchBlock className="h-3 w-12 rounded-full" />
              </div>
            ))}
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}

export function ObservabilityGraphLoadingSkeleton() {
  return (
    <div data-testid="observability-graph-loading-skeleton" className="flex h-full min-h-[520px] flex-col rounded-xl border border-border/60 bg-surface-modal p-5">
      <div data-structural-region data-reveal-order="0" className="flex items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <SketchBlock className="size-9 rounded-lg" />
          <div>
            <SkeletonLine className="w-44" />
            <SkeletonLine className="mt-2 w-28" />
          </div>
        </div>
        <SketchBlock className="h-8 w-32 rounded-lg" />
      </div>
      <div data-structural-region data-reveal-order="1" className="relative mt-5 flex-1 overflow-hidden rounded-xl border border-border/50 bg-surface-input/15">
        <div className="absolute inset-5 grid grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="rounded-lg border border-border/60 bg-surface-modal p-3">
              <SkeletonLine className="w-3/4" />
              <SkeletonLine className="mt-2 w-1/2" />
            </div>
          ))}
        </div>
      </div>
      <div data-structural-region data-reveal-order="2" className="mt-4 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-lg border border-border/50 p-3">
            <SkeletonLine className="w-1/2" />
            <SkeletonLine className="mt-2 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuietListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div data-testid="quiet-list-skeleton" className="space-y-3">
      {Array.from({ length: rows }, (_, item) => (
        <div key={item} className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-modal p-4">
          <SketchBlock className="size-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <SketchBlock className="h-3 w-1/3" />
            <SketchBlock className="mt-2 h-3 w-4/5" />
          </div>
          <SketchBlock className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function QuietGraphSkeleton() {
  return (
    <div data-testid="quiet-graph-skeleton" className="grid min-h-[420px] grid-cols-3 gap-4 rounded-xl border border-border/60 bg-surface-modal p-5">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="rounded-lg border border-border/60 bg-surface-input/20 p-4">
          <SketchBlock className="h-3 w-1/2" />
          <SketchBlock className="mt-3 h-3 w-4/5" />
          <SketchBlock className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
