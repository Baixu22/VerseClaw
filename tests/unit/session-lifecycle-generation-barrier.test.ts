// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ entry: { sessionId: 'restored-generation', updatedAt: 1 }, patch: vi.fn() }));

vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({
  loadSessionEntry: () => ({ entry: state.entry, storePath: 'isolated-owner-store', canonicalKey: 'agent:main:main' }),
}));
vi.mock('../../openclaw_runtime/src/config/sessions.js', () => ({
  updateSessionStoreEntry: async (input: { update: (entry: typeof state.entry) => Promise<unknown> }) => {
    const patch = await input.update(state.entry);
    if (patch) state.patch(patch);
  },
}));

import { persistGatewaySessionLifecycleEvent } from '../../openclaw_runtime/src/gateway/session-lifecycle-state';

beforeEach(() => state.patch.mockReset());

describe('persisted session lifecycle generation barrier', () => {
  it('rejects a stamped previous generation against a restored row', async () => {
    await persistGatewaySessionLifecycleEvent({
      sessionKey: 'agent:main:main',
      event: { sessionId: 'archived-generation', ts: 2, data: { phase: 'end' } },
    });
    expect(state.patch).not.toHaveBeenCalled();
  });

  it('preserves the legacy update path when a producer has no ownership stamp', async () => {
    await persistGatewaySessionLifecycleEvent({
      sessionKey: 'agent:main:main',
      event: { ts: 2, data: { phase: 'end' } },
    });
    expect(state.patch).toHaveBeenCalledTimes(1);
  });

  it('accepts a terminal event stamped by the current generation owner', async () => {
    await persistGatewaySessionLifecycleEvent({ sessionKey: 'agent:main:main', event: { sessionId: 'restored-generation', ts: 2, data: { phase: 'end' } } });
    expect(state.patch).toHaveBeenCalledTimes(1);
  });
});
