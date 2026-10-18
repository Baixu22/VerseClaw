import { hostApi } from '@/lib/host-api';

const SHED_STATE_REFRESH_MS = 30_000;

let cachedShed = false;
let lastRefreshAt = 0;
let refreshInFlight: Promise<void> | null = null;

/**
 * Shared renderer-side shed signal for cooperative poll scheduling.
 *
 * The Main process owns the actual policy. This adapter keeps one short-lived
 * cached view so several page schedulers do not each issue a status read on
 * every tick; a failed read fails open and cannot strand background work.
 */
export function isResourceShed(): boolean {
  const now = Date.now();
  if (!refreshInFlight && now - lastRefreshAt >= SHED_STATE_REFRESH_MS) {
    lastRefreshAt = now;
    refreshInFlight = (async () => {
      try {
        const state = await hostApi.efficiency.getState();
        cachedShed = Boolean(state.shed?.shedding || state.backgroundWork?.deferring);
      } catch {
        // Fail open: a status read failure must not suspend useful refresh.
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return cachedShed;
}

export function resetResourceShedForTest(): void {
  cachedShed = false;
  lastRefreshAt = 0;
  refreshInFlight = null;
}
