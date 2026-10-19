import { useEffect, useState } from 'react';

/**
 * Ticking clock for elapsed-time displays.
 *
 * The 1 Hz re-render stays inside the small component that actually shows the
 * elapsed time, instead of lifting a ticking `now` state to a page-level
 * component (which would re-render the whole page tree every second while a
 * run is active). Only ticks while `active` is true; idle components never
 * schedule an interval.
 */
export function useTickingNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // Do not set state synchronously in the effect; the first timer tick
    // (at most one second later) refreshes the initial value instead.
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);

  return now;
}

