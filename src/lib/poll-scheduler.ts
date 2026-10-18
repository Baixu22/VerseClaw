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
  const isVisible = options.isVisible ?? (() => (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  ));
  const canRun = options.canRun ?? (() => true);
  const isShed = options.isShed ?? (() => false);
  const isInteractive = options.priority === 'interactive';
  const tick = () => {
    // Interactive work is never suppressed by resource pressure (I1).
    if (!isInteractive && isShed()) return;
    if (inFlight || !isVisible() || !canRun()) return;
    inFlight = true;
    Promise.resolve(options.task()).finally(() => { inFlight = false; });
  };
  const start = () => {
    if (timer) return;
    timer = setInterval(tick, Math.max(100, Math.floor(options.intervalMs)));
  };
  start();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
