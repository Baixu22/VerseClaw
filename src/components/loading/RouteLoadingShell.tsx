import { useLayoutEffect } from 'react';
import { ShimmerBlock } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';

const BOOT_SHELL_TRANSITION_MS = 160;
const MAX_E2E_BOOT_HOLD_MS = 30_000;

function getE2EBootHoldMs(): number {
  const value = Number(new URLSearchParams(window.location.search).get('e2eBootHoldMs'));
  return Number.isFinite(value) && value > 0
    ? Math.min(value, MAX_E2E_BOOT_HOLD_MS)
    : 0;
}

/** Remove the static HTML shell only after a real renderer shell has committed. */
export function BootShellHandoff() {
  useLayoutEffect(() => {
    const bootShell = document.getElementById('boot-shell');
    if (!bootShell) return;

    const startedAt = Number(document.documentElement.dataset.bootStartedAt);
    const elapsed = Number.isFinite(startedAt) ? performance.now() - startedAt : 0;
    const holdMs = Math.max(0, getE2EBootHoldMs() - elapsed);
    let removalTimer = 0;

    const handoffTimer = window.setTimeout(() => {
      bootShell.dataset.state = 'leaving';
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      removalTimer = window.setTimeout(
        () => bootShell.remove(),
        reducedMotion ? 0 : BOOT_SHELL_TRANSITION_MS,
      );
    }, holdMs);

    return () => {
      window.clearTimeout(handoffTimer);
      window.clearTimeout(removalTimer);
    };
  }, []);

  return null;
}

function SkeletonLine({ className }: { className: string }) {
  return <ShimmerBlock className={cn('rounded-full', className)} />;
}

export function ChatRouteLoadingShell() {
  return (
    <div
      data-testid="route-loading-chat"
      className="flex h-full min-h-[420px] flex-col"
      aria-busy="true"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 pb-4">
        <div className="space-y-2">
          <SkeletonLine className="h-4 w-36" />
          <SkeletonLine className="h-2.5 w-20" />
        </div>
        <ShimmerBlock className="size-8 rounded-lg" />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 py-8">
        <div className="flex justify-end">
          <div className="w-[58%] space-y-2 rounded-2xl rounded-br-md bg-surface-input/70 p-4">
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="h-3 w-4/5" />
          </div>
        </div>
        <div className="flex gap-3">
          <ShimmerBlock className="size-8 shrink-0 rounded-xl" />
          <div className="w-[72%] space-y-3 pt-1">
            <SkeletonLine className="h-3 w-5/6" />
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="h-3 w-2/3" />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border/70 bg-surface-modal p-4 shadow-sm">
        <SkeletonLine className="h-3 w-2/5" />
        <div className="mt-8 flex items-center justify-between">
          <div className="flex gap-2">
            <ShimmerBlock className="size-7 rounded-lg" />
            <ShimmerBlock className="size-7 rounded-lg" />
          </div>
          <ShimmerBlock className="size-8 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function SettingsRouteLoadingShell() {
  return (
    <div
      data-testid="route-loading-settings"
      className="mx-auto w-full max-w-6xl"
      aria-busy="true"
    >
      <div className="mb-10 flex items-start justify-between">
        <div className="space-y-3">
          <SkeletonLine className="h-10 w-52" />
          <SkeletonLine className="h-3 w-72 max-w-[70vw]" />
        </div>
        <ShimmerBlock className="size-9 rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div
            key={item}
            className="rounded-2xl border border-border/60 bg-surface-modal p-5"
          >
            <ShimmerBlock className="mb-5 size-9 rounded-xl" />
            <SkeletonLine className="mb-3 h-4 w-28" />
            <SkeletonLine className="h-3 w-full" />
            <SkeletonLine className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenericRouteLoadingShell() {
  return (
    <div
      data-testid="route-loading-generic"
      className="mx-auto w-full max-w-5xl"
      aria-busy="true"
    >
      <div className="mb-8 space-y-3">
        <SkeletonLine className="h-9 w-48" />
        <SkeletonLine className="h-3 w-80 max-w-[75vw]" />
      </div>
      <div className="space-y-4">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-2xl border border-border/60 bg-surface-modal p-6">
            <SkeletonLine className="h-4 w-1/4" />
            <SkeletonLine className="mt-4 h-3 w-full" />
            <SkeletonLine className="mt-2 h-3 w-3/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SetupRouteLoadingShell() {
  return (
    <div
      data-testid="route-loading-setup"
      className="flex min-h-screen items-center justify-center bg-background p-8"
      aria-busy="true"
    >
      <BootShellHandoff />
      <div className="w-full max-w-2xl rounded-3xl border border-border/60 bg-surface-modal p-8 shadow-sm">
        <ShimmerBlock className="mb-8 h-14 w-[70px] rounded-2xl" />
        <SkeletonLine className="h-9 w-64 max-w-full" />
        <SkeletonLine className="mt-4 h-3 w-full" />
        <SkeletonLine className="mt-2 h-3 w-4/5" />
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <ShimmerBlock className="h-28 rounded-2xl" />
          <ShimmerBlock className="h-28 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
