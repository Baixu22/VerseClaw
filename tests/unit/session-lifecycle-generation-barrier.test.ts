// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from '../../openclaw_runtime/src/config/sessions/types';

const state = vi.hoisted(() => ({ entry: { sessionId: 'restored-generation', updatedAt: 1 } as SessionEntry, patch: vi.fn() }));

vi.mock('../../openclaw_runtime/src/gateway/session-utils.js', () => ({
  loadSessionEntry: () => ({ entry: state.entry, storePath: 'isolated-owner-store', canonicalKey: 'agent:main:main' }),
}));
vi.mock('../../openclaw_runtime/src/config/sessions.js', async () => ({
  ...(await import('../../openclaw_runtime/src/config/sessions/types')),
  updateSessionStore: async (_path: string, update: (store: Record<string, SessionEntry>) => unknown) => {
    const store = { 'agent:main:main': state.entry };
    const result = update(store);
    state.entry = store['agent:main:main'];
    return result;
  },
  updateSessionStoreEntry: async (input: { update: (entry: typeof state.entry) => Promise<unknown> }) => {
    const patch = await input.update(state.entry);
    if (patch) {
      state.patch(patch);
      Object.assign(state.entry, patch);
    }
  },
}));
vi.mock('../../openclaw_runtime/src/agents/model-selection.js', () => ({ isCliProvider: () => false, normalizeProviderId: (value: string) => value }));
vi.mock('../../openclaw_runtime/src/config/sessions/store.js', () => ({
  updateSessionStore: async (_path: string, update: (store: Record<string, SessionEntry>) => unknown) => {
    const store = { 'agent:main:main': state.entry };
    const result = update(store);
    state.entry = store['agent:main:main'];
    return result;
  },
}));

import { persistGatewaySessionLifecycleEvent } from '../../openclaw_runtime/src/gateway/session-lifecycle-state';
import { persistSessionEntry as persistAgentSessionMetadata } from '../../openclaw_runtime/src/agents/command/attempt-execution.shared';
import { updateSessionStoreAfterAgentRun, clearCliSessionInStore, recordCliCompactionInStore } from '../../openclaw_runtime/src/agents/command/session-store';

beforeEach(() => {
  state.patch.mockReset();
  state.entry = { sessionId: 'restored-generation', updatedAt: 1 };
});

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

it('persists the lifecycle run identity together with each new attempt', async () => {
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'recovery-run', ts: 100, data: { phase: 'start', startedAt: 100 } },
  });
  expect(state.patch).toHaveBeenLastCalledWith(expect.objectContaining({
    lifecycleRunId: 'recovery-run', status: 'running', startedAt: 100,
  }));
});

it.each(['end', 'error'] as const)('ignores an old run %s after a newer run starts in the same session', async (phase) => {
  state.entry = { ...state.entry, lifecycleRunId: 'current-run', startedAt: 200, status: 'running', abortedLastRun: true };
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'previous-run', ts: 300, data: { phase, startedAt: 100 } },
  });
  expect(state.patch).not.toHaveBeenCalled();
  expect(state.entry).toMatchObject({ lifecycleRunId: 'current-run', status: 'running', abortedLastRun: true });
});

it('ignores a late start from an older run without regressing the current owner', async () => {
  state.entry = { ...state.entry, lifecycleRunId: 'current-run', startedAt: 200, status: 'running' };
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'previous-run', ts: 100, data: { phase: 'start', startedAt: 100 } },
  });
  expect(state.patch).not.toHaveBeenCalled();
});

it('accepts a newer run and only lets that run finish the current lifecycle', async () => {
  state.entry = { ...state.entry, lifecycleRunId: 'previous-run', startedAt: 100, status: 'running' };
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'current-run', ts: 200, data: { phase: 'start', startedAt: 200 } },
  });
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'current-run', ts: 300, data: { phase: 'end', startedAt: 200 } },
  });
  expect(state.entry).toMatchObject({ lifecycleRunId: 'current-run', status: 'done', startedAt: 200, endedAt: 300 });
});

it('records a newer continuation failure emitted before lifecycle start', async () => {
  state.entry = { ...state.entry, lifecycleRunId: 'interrupted-run', startedAt: 100, status: 'running', abortedLastRun: false };
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'continuation-run', ts: 300, data: { phase: 'error', startedAt: 200, error: 'model auth setup failed' } },
  });
  expect(state.entry).toMatchObject({ lifecycleRunId: 'continuation-run', status: 'failed', startedAt: 200, endedAt: 300 });
});

it('does not let an unstamped late terminal claim a different run based on arrival time', async () => {
  state.entry = { ...state.entry, lifecycleRunId: 'current-run', startedAt: 200, status: 'running' };
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'previous-run', ts: 300, data: { phase: 'error' } },
  });
  expect(state.patch).not.toHaveBeenCalled();
});

it('clears a previous ownership stamp when an unstamped producer starts new work', async () => {
  state.entry = { ...state.entry, lifecycleRunId: 'previous-run', startedAt: 100, status: 'done' };
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', ts: 200, data: { phase: 'start', startedAt: 200 } },
  });
  expect(state.entry.lifecycleRunId).toBeUndefined();
});

it('keeps the lifecycle owner when agent metadata is saved from an older snapshot', async () => {
  const stale = { ...state.entry, lifecycleRunId: 'previous-run', status: 'done' as const, startedAt: 100, endedAt: 150, runtimeMs: 50 };
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'current-run', ts: 200, data: { phase: 'start', startedAt: 200 } },
  });
  await persistAgentSessionMetadata({
    sessionKey: 'agent:main:main', sessionStore: {}, storePath: 'isolated-owner-store',
    entry: { ...stale, thinkingLevel: 'high' },
  });
  expect(state.entry).toMatchObject({ lifecycleRunId: 'current-run', status: 'running', startedAt: 200, thinkingLevel: 'high' });
  expect(state.entry.endedAt).toBeUndefined();
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'current-run', ts: 300, data: { phase: 'end', startedAt: 200 } },
  });
  expect(state.entry.status).toBe('done');
});

it('does not restore running status when same-run metadata arrives after its terminal event', async () => {
  const stale = { ...state.entry, lifecycleRunId: 'current-run', status: 'running' as const, startedAt: 200, abortedLastRun: false };
  state.entry = { ...stale, status: 'killed', endedAt: 300, runtimeMs: 100, abortedLastRun: true };
  await persistAgentSessionMetadata({
    sessionKey: 'agent:main:main', sessionStore: {}, storePath: 'isolated-owner-store',
    entry: { ...stale, thinkingLevel: 'high' },
  });
  expect(state.entry).toMatchObject({ lifecycleRunId: 'current-run', status: 'killed', endedAt: 300, abortedLastRun: true, thinkingLevel: 'high' });
});

it('keeps the current lifecycle run through the post-run usage metadata writer', async () => {
  const stale = { ...state.entry, lifecycleRunId: 'previous-run', status: 'done' as const, startedAt: 100 };
  state.entry = { ...state.entry, lifecycleRunId: 'current-run', status: 'running', startedAt: 200 };
  await updateSessionStoreAfterAgentRun({
    cfg: {}, contextTokensOverride: 8192, sessionId: state.entry.sessionId,
    sessionKey: 'agent:main:main', sessionStore: { 'agent:main:main': stale }, storePath: 'isolated-owner-store',
    defaultProvider: 'test', defaultModel: 'test', result: { meta: { durationMs: 100 } },
  });
  expect(state.entry).toMatchObject({ lifecycleRunId: 'current-run', status: 'running', startedAt: 200, contextTokens: 8192 });
  await persistGatewaySessionLifecycleEvent({
    sessionKey: 'agent:main:main',
    event: { sessionId: 'restored-generation', runId: 'current-run', ts: 300, data: { phase: 'end', startedAt: 200 } },
  });
  expect(state.entry.status).toBe('done');
});

it.each([['clear', clearCliSessionInStore], ['compact', recordCliCompactionInStore]] as const)('keeps current lifecycle ownership through sibling CLI metadata writer %s', async (_name, write) => {
  const stale = { ...state.entry, lifecycleRunId: 'previous-run', status: 'done' as const, startedAt: 100 };
  state.entry = { ...state.entry, lifecycleRunId: 'current-run', status: 'running', startedAt: 200 };
  await write({ provider: 'test', sessionKey: 'agent:main:main', sessionStore: { 'agent:main:main': stale }, storePath: 'isolated-owner-store' });
  expect(state.entry).toMatchObject({ lifecycleRunId: 'current-run', status: 'running', startedAt: 200 });
});
