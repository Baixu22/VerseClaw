import type { RequestPriority } from '@shared/types/resources';
import { hostApi } from './host-api';
import { hostEvents } from './host-events';

export type PollSchedulerOptions = {
  intervalMs: number;
  priority?: RequestPriority;
  isShed?: () => boolean;
  task: () => void | Promise<void>;
  isVisible?: () => boolean;
  canRun?: () => boolean;
  immediate?: boolean;
};

/**
 * P1 renderer poll scheduler. One timer per registered surface; hidden pages
 * stop issuing work, and a blocked/shaded surface keeps the timer but skips
 * the task rather than creating a second polling loop.
 */
export function createPollScheduler(options: PollSchedulerOptions): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let disposed = false;
  let nativeVisible: boolean | undefined;
  let visibilityVersion = 0;
  const native = typeof window !== 'undefined' && Boolean(window.verseClaw?.hostInvoke) && !options.isVisible;
  let visibilityReady = !native;
  const isVisible = options.isVisible ?? (() => (
    nativeVisible ?? (typeof document === 'undefined' || document.visibilityState !== 'hidden')
  ));
  const canRun = options.canRun ?? (() => true);
  const isShed = options.isShed ?? (() => false);
  const isInteractive = options.priority === 'interactive';
  const tick = (restored = false) => {
    if (disposed || !visibilityReady || inFlight || !isVisible() || !canRun()) return;
    // Interactive work is never suppressed by resource pressure (I1).
    if (!restored && !isInteractive && isShed()) return;
    inFlight = true;
    try {
      void Promise.resolve(options.task()).then(
        () => { inFlight = false; },
        () => { inFlight = false; },
      );
    } catch {
      inFlight = false;
    }
  };
  const start = () => {
    if (timer) return;
    timer = setInterval(tick, Math.max(100, Math.floor(options.intervalMs)));
  };
  start();
  // Returning to a view is an explicit read; refresh once even while background work is shed.
  const onVisibility = () => { if (isVisible()) tick(true); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  const stopNative = native ? hostEvents.onWindowVisibility(visible => {
    if (disposed) return;
    const wasVisible = nativeVisible;
    visibilityVersion += 1;
    nativeVisible = visible;
    visibilityReady = true;
    if (visible && wasVisible !== true) tick(true);
  }) : undefined;
  if (native) {
    const version = visibilityVersion;
    void hostApi.window.isVisible().then(visible => {
      if (disposed || version !== visibilityVersion) return;
      nativeVisible = visible;
      visibilityReady = true;
      if (options.immediate) tick();
    }, () => { visibilityReady = true; if (options.immediate) tick(); });
  } else if (options.immediate) tick();
  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
    timer = null;
    stopNative?.();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
