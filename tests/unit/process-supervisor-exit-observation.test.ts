// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChildAdapter: vi.fn(),
  captureProcessTrees: vi.fn(),
  verifyProcessTreesTerminated: vi.fn(),
  signalProcessTree: vi.fn(),
}));
vi.mock('../../openclaw_runtime/src/process/supervisor/adapters/child.js', () => ({ createChildAdapter: mocks.createChildAdapter }));
vi.mock('../../openclaw_runtime/src/process/os-containment.js', () => ({
  captureProcessTrees: mocks.captureProcessTrees,
  verifyProcessTreesTerminated: mocks.verifyProcessTreesTerminated,
}));
vi.mock('../../openclaw_runtime/src/process/kill-tree.js', () => ({ signalProcessTree: mocks.signalProcessTree }));

import { createProcessSupervisor } from '../../openclaw_runtime/src/process/supervisor/supervisor.js';
import type { OsProcessTreeCapture } from '../../openclaw_runtime/src/process/os-containment.js';

const platform = process.platform;
const identity = { agentId: 'test', canonicalSessionKey: 'agent:test:main', expectedSessionId: 'session' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
});

async function start() {
  const exit = deferred<{ code: number; signal: null }>();
  const capture = deferred<OsProcessTreeCapture>();
  const adapter = { pid: 12345, wait: () => exit.promise, kill: vi.fn(), dispose: vi.fn(), onStdout: vi.fn(), onStderr: vi.fn() };
  mocks.createChildAdapter.mockResolvedValue(adapter);
  mocks.captureProcessTrees.mockReturnValue(capture.promise);
  const supervisor = createProcessSupervisor();
  const run = await supervisor.spawn({
    mode: 'child', argv: ['fixture'], sessionId: identity.expectedSessionId, backendId: 'fixture',
    lifecycleAgentId: identity.agentId, lifecycleCanonicalSessionKey: identity.canonicalSessionKey,
    lifecycleExpectedSessionId: identity.expectedSessionId,
  });
  return { supervisor, run, adapter, exit, capture };
}

describe('process supervisor observed root exit', () => {
  it.each(['ok', 'unknown'] as const)('stops signalling an exited root while %s OS evidence is pending', async (status) => {
    const { supervisor, run, adapter, exit, capture } = await start();
    run.cancel();
    expect(adapter.kill.mock.calls).toEqual([['SIGTERM']]);
    exit.resolve({ code: 0, signal: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.captureProcessTrees).toHaveBeenCalledWith([12345]);
    expect(supervisor.countActiveRunsForLifecycle(identity)).toBe(1);

    await vi.advanceTimersByTimeAsync(6000);
    supervisor.cancel(run.runId);
    const drain = supervisor.drainRunsForLifecycle(identity, 15000);
    expect(adapter.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(mocks.signalProcessTree).not.toHaveBeenCalled();
    expect(supervisor.countActiveRunsForLifecycle(identity)).toBe(1);

    capture.resolve({ status, rootPids: [12345], capturedPids: new Map(), ...(status === 'unknown' ? { detail: 'probe unavailable' } : {}) });
    expect((await run.wait()).termination).toBe(status === 'ok' ? 'verified' : 'unknown');
    expect((await drain).drained).toBe(true);
    expect(supervisor.countActiveRunsForLifecycle(identity)).toBe(0);
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it('still escalates cancellation while the child has not exited', async () => {
    const { run, adapter, exit, capture } = await start();
    run.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    exit.resolve({ code: 0, signal: null });
    capture.resolve({ status: 'unknown', rootPids: [12345], capturedPids: new Map() });
    expect((await run.wait()).termination).toBe('unknown');
  });
});
