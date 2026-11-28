// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), capture: vi.fn(), verify: vi.fn() }));
vi.mock('../../openclaw_runtime/src/process/supervisor/adapters/child', () => ({ createChildAdapter: mocks.create }));
vi.mock('../../openclaw_runtime/src/process/os-containment', () => ({ captureProcessTrees: mocks.capture, verifyProcessTreesTerminated: mocks.verify }));
import { createProcessSupervisor } from '../../openclaw_runtime/src/process/supervisor/supervisor';

beforeEach(() => { mocks.create.mockReset(); mocks.capture.mockReset(); mocks.verify.mockReset(); });

it('retains the original creation token and marks an exited root inactive while containment waits', async () => {
  let finish!: (value: { code: number; signal: null }) => void;
  let finishCapture!: (value: unknown) => void;
  let rootActive = true;
  const exit = new Promise<{ code: number; signal: null }>(resolve => { finish = resolve; });
  const pendingCapture = new Promise(resolve => { finishCapture = resolve; });
  mocks.create.mockResolvedValue({ pid: 100, isRootActive: () => rootActive, wait: () => exit, onStdout() {}, onStderr() {}, dispose() {}, kill() {} });
  mocks.capture.mockResolvedValueOnce({ status: 'ok', capturedPids: new Map([[100, 'original']]) }).mockReturnValueOnce(pendingCapture);
  const supervisor = createProcessSupervisor();
  const identity = { agentId: 'main', canonicalSessionKey: 'agent:main:identity', expectedSessionId: 'generation' };
  const run = await supervisor.spawn({ mode: 'child', argv: ['fixture'], backendId: 'test', sessionId: 'generation', runId: 'identity-run',
    lifecycleAgentId: identity.agentId, lifecycleCanonicalSessionKey: identity.canonicalSessionKey,
    lifecycleExpectedSessionId: identity.expectedSessionId });
  await vi.waitFor(() => expect(supervisor.snapshotRunsForLifecycle(identity)[0])
    .toMatchObject({ pid: 100, creationToken: 'original', rootActive: true }));
  rootActive = false;
  expect(supervisor.snapshotRunsForLifecycle(identity)[0]).toMatchObject({ creationToken: 'original', rootActive: false });
  finish({ code: 0, signal: null });
  await vi.waitFor(() => expect(supervisor.snapshotRunsForLifecycle(identity)[0])
    .toMatchObject({ creationToken: 'original', rootActive: false }));
  finishCapture({ status: 'ok', capturedPids: new Map() });
  await run.wait();
  expect(supervisor.snapshotRunsForLifecycle(identity)).toEqual([]);
});

it('discards the initial creation sample when its original root exits before capture resolves', async () => {
  let finish!: (value: { code: number; signal: null }) => void;
  let capture!: (value: unknown) => void;
  let rootActive = true;
  const exit = new Promise<{ code: number; signal: null }>(resolve => { finish = resolve; });
  const initialCapture = new Promise(resolve => { capture = resolve; });
  mocks.create.mockResolvedValue({ pid: 100, isRootActive: () => rootActive, wait: () => exit,
    onStdout() {}, onStderr() {}, dispose() {}, kill() {} });
  mocks.capture.mockReturnValueOnce(initialCapture).mockResolvedValueOnce({ status: 'ok', capturedPids: new Map() });
  const supervisor = createProcessSupervisor();
  const identity = { agentId: 'main', canonicalSessionKey: 'agent:main:identity', expectedSessionId: 'generation' };
  const run = await supervisor.spawn({ mode: 'child', argv: ['fixture'], backendId: 'test', sessionId: 'generation',
    lifecycleAgentId: identity.agentId, lifecycleCanonicalSessionKey: identity.canonicalSessionKey,
    lifecycleExpectedSessionId: identity.expectedSessionId });
  rootActive = false;
  capture({ status: 'ok', capturedPids: new Map([[100, 'reused']]) });
  await initialCapture;
  await Promise.resolve();
  expect(supervisor.snapshotRunsForLifecycle(identity)[0]).toMatchObject({ creationToken: undefined, rootActive: false });
  finish({ code: 0, signal: null });
  await run.wait();
});
