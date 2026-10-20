import { SketchBlock } from '@/components/loading/StructuralSketch';
import { useDelayedVisibility } from '@/components/loading/use-delayed-visibility';
import { cn } from '@/lib/utils';

export type SettingsSectionSkeletonVariant =
  | 'agent-list'
  | 'skill-list'
  | 'channel-grid'
  | 'billing'
  | 'archived'
  | 'settings-rows'
  | 'generic';

function SkeletonRow({ tall = false }: { tall?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface-modal p-4">
      <div className="flex items-start gap-3">
        <SketchBlock className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <SketchBlock className={cn('w-2/5', tall ? 'h-4' : 'h-3')} />
          <SketchBlock className="mt-3 h-3 w-4/5" />
          <SketchBlock className="mt-2 h-3 w-3/5" />
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="rounded-xl border border-border/60 bg-surface-modal p-5">
          <SketchBlock className="size-9 rounded-xl" />
          <SketchBlock className="mt-4 h-4 w-1/3" />
          <SketchBlock className="mt-3 h-3 w-4/5" />
          <SketchBlock className="mt-2 h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

function SkeletonBilling() {
  const bars = ['h-20', 'h-32', 'h-24', 'h-40', 'h-28', 'h-36', 'h-24'];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-xl border border-border/60 bg-surface-modal p-4">
            <SketchBlock className="h-3 w-2/3" />
            <SketchBlock className="mt-4 h-7 w-1/2" />
            <SketchBlock className="mt-3 h-3 w-4/5" />
          </div>
        ))}
      </div>
      <div className="h-72 rounded-2xl border border-border/60 bg-surface-modal p-5">
        <SketchBlock className="h-4 w-40" />
        <div className="mt-6 flex h-48 items-end gap-3">
          {bars.map((height, index) => (
            <div key={index} className="flex h-full flex-1 items-end">
              <SketchBlock className={cn('w-full rounded-t-md', height)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonVariant({ variant }: { variant: SettingsSectionSkeletonVariant }) {
  if (variant === 'channel-grid') return <SkeletonGrid />;
  if (variant === 'billing') return <SkeletonBilling />;
  if (variant === 'archived') {
    return <div className="space-y-3">{[0, 1, 2, 3].map((item) => <SkeletonRow key={item} />)}</div>;
  }
  if (variant === 'agent-list') {
    return <div className="space-y-3">{[0, 1, 2, 3].map((item) => <SkeletonRow key={item} tall />)}</div>;
  }
  if (variant === 'skill-list') {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 border-b border-border/60 pb-3">
          {[0, 1, 2].map((item) => <SketchBlock key={item} className="h-8 w-20 rounded-full" />)}
        </div>
        <div className="space-y-3">{[0, 1, 2, 3].map((item) => <SkeletonRow key={item} />)}</div>
      </div>
    );
  }
  if (variant === 'generic') {
    return <div className="space-y-3">{[0, 1].map((item) => <SkeletonRow key={item} />)}</div>;
  }
  return <div className="space-y-3">{[0, 1, 2, 3, 4].map((item) => <SkeletonRow key={item} />)}</div>;
}

export function SettingsSectionLoading({
  label,
  variant = 'settings-rows',
}: {
  label: string;
  variant?: SettingsSectionSkeletonVariant;
}) {
  const visible = useDelayedVisibility(true, 200);

  return (
    <div
      data-testid="settings-section-loading"
      data-variant={variant}
      data-structural-sketch-root
      data-state={visible ? 'visible' : 'pending'}
      className={cn('min-h-72 space-y-4', !visible && 'opacity-0')}
      aria-busy="true"
    >
      <span className="sr-only" role="status">{label}</span>
      {visible ? (
        <div data-testid="settings-section-loading-skeleton" className="animate-in fade-in duration-150 motion-reduce:animate-none">
          <SkeletonVariant variant={variant} />
        </div>
      ) : null}
    </div>
  );
}