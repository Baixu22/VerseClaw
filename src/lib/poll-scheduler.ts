import type { RequestPriority } from '@shared/types/resources';

export type PollSchedulerOptions = {
  intervalMs: number;
  priority?: RequestPriority;
  isShed?: () => boolean;
  task: () => void | Promise<void>;
  isVisible?: () => boolean;
  canRun?: () => boolean;
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
  const isVisible = options.isVisible ?? (() => (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  ));
  const canRun = options.canRun ?? (() => true);
  const isShed = options.isShed ?? (() => false);
  const isInteractive = options.priority === 'interactive';
  const tick = (restored = false) => {
    if (disposed || inFlight || !isVisible() || !canRun()) return;
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
  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
