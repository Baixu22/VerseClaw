// R2: observability store must store a sanitized message + errorId, never the
// raw backend error, so the page never renders stack frames or secrets.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardMock = vi.fn();
const queryMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    observability: {
      dashboardSnapshot: () => dashboardMock(),
      queryTraces: () => queryMock(),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: { onObservabilityRuntimeEvent: () => () => {} },
}));

describe('observability store error sanitize (R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a sanitized error message with an errorId', async () => {
    dashboardMock.mockRejectedValue(new Error('fetch failed at C:\\Users\\me\\secret.ts sk-12345678901234567890'));
    const { useObservabilityStore } = await import('@/stores/observability');

    await useObservabilityStore.getState().fetchDashboard();

    const error = useObservabilityStore.getState().error;
    expect(error).toBeTruthy();
    expect(error).not.toContain('secret.ts');
    expect(error).not.toContain('sk-12345678901234567890');
    expect(useObservabilityStore.getState().errorId).toMatch(/^err-/);
  });
});
