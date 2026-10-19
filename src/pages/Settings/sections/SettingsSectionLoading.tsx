import { useEffect, useState } from 'react';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { ShimmerBlock } from '@/components/ai-elements/shimmer';
import { StructuralLoadingOverlay } from '@/components/loading/StructuralLoadingOverlay';

export function SettingsSectionLoading({ label }: { label: string }) {
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showStatus, setShowStatus] = useState(false);

  useEffect(() => {
    const skeletonTimer = window.setTimeout(() => setShowSkeleton(true), 100);
    const statusTimer = window.setTimeout(() => setShowStatus(true), 600);
    return () => {
      window.clearTimeout(skeletonTimer);
      window.clearTimeout(statusTimer);
    };
  }, []);

  return (
    <StructuralLoadingOverlay
      data-testid="settings-section-loading"
      label={label}
      className="min-h-72 space-y-5"
    >
      <div
        data-testid="settings-section-loading-status"
        data-structural-region
        className={showStatus
          ? 'flex h-6 items-center gap-2 text-xs text-muted-foreground opacity-100 transition-opacity duration-150 motion-reduce:transition-none'
          : 'flex h-6 items-center gap-2 text-xs text-muted-foreground opacity-0'}
      >
        <OrbStatus state="loading" label={label} className="size-3.5" />
        <span>{label}</span>
      </div>
      <div
        data-testid="settings-section-loading-skeleton"
        data-structural-region
        className={showSkeleton
          ? 'space-y-5 opacity-100 transition-opacity duration-150 motion-reduce:transition-none'
          : 'space-y-5 opacity-0'}
      >
        <div className="space-y-2">
          <ShimmerBlock className="h-7 w-44" />
          <ShimmerBlock className="h-3 w-full max-w-xl" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} data-structural-region className="space-y-3 rounded-xl border border-border bg-surface-modal p-4">
              <ShimmerBlock className="h-4 w-28" />
              <ShimmerBlock className="h-3 w-full" />
              <ShimmerBlock className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </StructuralLoadingOverlay>
  );
}

