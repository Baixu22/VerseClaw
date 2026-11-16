// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import { normalizeRunScope, normalizeTaskReference } from '@shared/types/identity-scope';
import type { SessionTaskEffectRequest, SessionTaskEffectAdmission } from '@shared/session-task-scope';
import type { ReplyOperation } from '../../openclaw_runtime/src/auto-reply/reply/reply-run-registry';
import type { AgentRunContext } from '../../openclaw_runtime/src/infra/agent-events';
import { createHostDeadline } from '@shared/host-api/host-deadline';
import { getHostDeadline, runWithHostDeadline } from '@electron/utils/host-deadline-context';

const runtime = vi.hoisted(() => ({ generation: 'generation-1', invoke: vi.fn(), abandoned: false,
  owner: null as ReplyOperation | null, worker: null as Record<string, unknown> | null,
  scheduled: null as AgentRunContext['cronTaskScope'] | null,
  processes: [] as Array<{ id?: string; sessionKey: string }>,
  supervised: [] as Array<{ runId: string; state: string; lifecycleExpectedSessionId?: string }>,
  reservations: [] as Array<{ id: string; ownerPid: number; owner: string; ports: number[]; phase: string;
    createdAt: number; sessionKey?: string; sessionGeneration?: string; runId?: string }> }));
vi.mock('../../openclaw_runtime/src/gateway/call', () => ({ callGateway: (...args: unknown[]) => runtime.invoke(...args) }));
vi.mock('../../openclaw_runtime/src/gateway/session-utils', () => ({
  loadSessionEntry: (key: string) => ({ canonicalKey: key, entry: { sessionId: runtime.generation,
    ...(runtime.worker?.childSessionKey === key ? { spawnedBy: runtime.worker.requesterSessionKey } : {}) } }),
}));
vi.mock('../../openclaw_runtime/src/infra/agent-events', () => ({ getAgentRunContext: () => ({ sessionId: 'generation-1', sessionKey: 'agent:main:task-scope-bridge', memoryFlushOwner: runtime.owner, cronTaskScope: runtime.scheduled }) }));
vi.mock('../../openclaw_runtime/src/agents/embedded-agent-runner/runs', () => ({
  isEmbeddedRunAbandoned: () => runtime.abandoned,
  isEmbeddedAgentExecutionActive: ({ runId: id }: { runId: string }) => runtime.supervised.some((entry) => entry.runId === id && entry.state === 'embedded'),
  resolveActiveEmbeddedRunHandleSessionId: () => runtime.supervised.some((entry) => entry.state === 'embedded') ? runtime.generation : undefined,
}));
vi.mock('../../openclaw_runtime/src/agents/bash-process-registry', () => ({ listRunningSessions: () => runtime.processes }));
vi.mock('../../openclaw_runtime/src/process/supervisor/index', () => ({ getProcessSupervisor: () => ({ snapshotRunsForSession: () => runtime.supervised.filter(entry => entry.state !== 'embedded') }) }));
vi.mock('../../openclaw_runtime/src/agents/verseshell/managed-process-reservation', () => ({ managedProcessReservations: () => runtime.reservations }));
vi.mock('../../openclaw_runtime/src/agents/subagent-registry', () => { throw new Error('Mutable subagent lifecycle bootstrap is unavailable'); });
vi.mock('../../openclaw_runtime/src/agents/subagent-registry-read', () => ({ getSubagentRunByRunId: () => null, getLatestSubagentRunByChildSessionKey: () => runtime.worker }));

import { registerSessionTaskScopeBridge } from '@electron/gateway/session-task-scope-bridge';
import { sessionTaskScopeHandlers } from '../../openclaw_runtime/src/gateway/server-methods/session-task-scope';
import { withSessionTaskScope, clearSessionTaskScopeRun, currentSessionTaskRequesterReference } from '../../openclaw_runtime/src/agents/session-task-scope';
import { runBeforeToolCallHook } from '../../openclaw_runtime/src/agents/agent-tools.before-tool-call';
import { replyRunRegistry } from '../../openclaw_runtime/src/auto-reply/reply/reply-run-registry';

const sessionKey = 'agent:main:task-scope-bridge';
const runId = 'run-bridge';
const tuple = { sessionKey, sessionGeneration: 'generation-1', runId };
const backend = { connId: 'desktop', connect: { caps: ['session-task-scope-bridge'] } };
const origin = { connId: 'runtime', connect: { caps: [] as string[] } };
const bus = new EventEmitter();
const active = new Map<string, { controller: AbortController; sessionKey: string; sessionId: string; workspaceId: string }>();
const context = {
  chatAbortControllers: active,
  getApprovalClientConnIds: vi.fn(() => [backend.connId]),
  broadcastToConnIds: vi.fn((method: string, params: unknown, recipients: Set<string>) => {
    expect([...recipients]).toEqual([backend.connId]);
    bus.emit('notification', { method, params });
  }),
};
function dispatch(method: string, params: unknown, client = origin): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const result = sessionTaskScopeHandlers[method]({ params, client, context,
      respond: (ok: boolean, payload: unknown, error: { message: string }) => ok ? resolve(payload) : reject(new Error(error?.message)),
    } as never);
    Promise.resolve(result).catch(reject);
  });
}
const gateway = Object.assign(bus, { rpc: (method: string, params: unknown) => dispatch(method, params, backend) });
let dispose: () => void;
let release: () => void;
let requests: SessionTaskEffectRequest[];
let hold: boolean;
function admission(request: SessionTaskEffectRequest): SessionTaskEffectAdmission {
  const task = normalizeTaskReference({ kind: 'ledger', taskNodeId: 'business-task' });
  if (task.kind !== 'ledger') throw new Error('wrong task');
  return { status: 'granted', bindingRevision: 1, claim: {
    id: 'writer-claim', taskNodeId: task.taskNodeId,
    run: normalizeRunScope({ runId, scope: { sessionKey, workspaceId: 'workspace-a' } }),
    sessionGeneration: request.sessionGeneration, createdAt: new Date(0).toISOString(),
  } };
}
function execute(effect = vi.fn(async () => 'written'), signal?: AbortSignal) {
  return withSessionTaskScope({ sessionKey, sessionId: 'generation-1', runId, workspaceDir: 'D:/project' }, 'write', {}, signal, effect);
}

beforeEach(() => {
  runtime.generation = 'generation-1'; runtime.abandoned = false; hold = false; requests = [];
  runtime.processes = []; runtime.supervised = []; runtime.reservations = [];
  runtime.owner = null; runtime.worker = null;
  runtime.scheduled = null;
  active.clear(); active.set(runId, { controller: new AbortController(), sessionKey, sessionId: 'generation-1', workspaceId: 'workspace-a' });
  context.getApprovalClientConnIds.mockReturnValue([backend.connId]);
  runtime.invoke.mockImplementation(({ method, params }) => dispatch(method, params));
  dispose = registerSessionTaskScopeBridge(gateway as unknown as GatewayManager, async (request) => {
    requests.push(request);
    if (hold) await new Promise<void>((resolve) => { release = resolve; });
    return admission(request);
  });
  vi.stubEnv('CLAWX_TASK_SCOPE_BRIDGE', '1');
});
afterEach(() => {
  runtime.owner?.complete(); runtime.owner = null;
  dispose(); clearSessionTaskScopeRun(runId); vi.unstubAllEnvs(); vi.useRealTimers();
  runtime.invoke.mockReset(); context.broadcastToConnIds.mockClear();
});

describe('runtime → Gateway → Main task admission bridge', () => {
  it('gives an unsolicited admission its own bounded deadline instead of the expired socket creator', async () => {
    dispose();
    const deadlines: Array<ReturnType<typeof getHostDeadline>> = [];
    const reply = vi.spyOn(gateway, 'rpc').mockImplementation(async (method, params) => {
      deadlines.push(getHostDeadline()); return dispatch(method, params, backend);
    });
    dispose = registerSessionTaskScopeBridge(gateway as unknown as GatewayManager, async request => {
      deadlines.push(getHostDeadline()); await new Promise(resolve => setTimeout(resolve, 5)); return admission(request);
    });
    try {
      const expired = createHostDeadline({ stage: 'renderer', timeoutMs: 1, requestId: 'old-gateway-start', now: () => Date.now() - 2000 });
      await runWithHostDeadline(expired, async () => {
        expect(await execute()).toBe('written');
        expect(getHostDeadline()).toBe(expired);
      });
      expect(deadlines).toHaveLength(2);
      for (const deadline of deadlines) {
        expect(deadline?.requestId).not.toBe('old-gateway-start');
        expect(deadline?.deadlineAtMs).toBeGreaterThan(Date.now());
        expect(deadline?.timeoutMs).toBe(20_000);
      }
      expect(deadlines[0]).toEqual(deadlines[1]);
    } finally { reply.mockRestore(); }
  });
  it('admits a direct embedded execution without a Chat tracker and rejects its former run id', async () => {
    active.delete(runId);
    runtime.supervised = [{ runId, state: 'embedded' }];
    expect(await execute()).toBe('written');
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ active: true, quiescent: false });
    runtime.supervised[0].runId = 'replacement-run';
    await expect(execute()).rejects.toThrow('TASK_SCOPE_RUN_STALE');
  });
  it('reads the scheduled run owner only while the exact embedded handle executes', async () => {
    active.delete(runId);
    runtime.supervised = [{ runId, state: 'embedded' }];
    runtime.scheduled = { jobId: 'job', workspaceDir: 'D:/scheduled-workspace' };
    runtime.generation = 'previous-stored-generation';
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ active: true,
      currentGeneration: tuple.sessionGeneration, scheduled: { jobId: 'job', workspaceDir: 'D:/scheduled-workspace' } });
    expect(await execute()).toBe('written');
    runtime.supervised = [];
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ active: false, scheduled: undefined });
    await expect(execute()).rejects.toThrow('TASK_SCOPE_RUN_STALE');
  });
  it('admits memory flush only while its exact reply operation owns the execution', async () => {
    active.delete(runId);
    const owner = replyRunRegistry.begin({ sessionKey, sessionId: 'generation-1', resetTriggered: false });
    owner.setPhase('memory_flushing'); runtime.owner = owner;
    expect(await execute()).toBe('written');
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ active: true, quiescent: false });
    owner.complete();
    const next = replyRunRegistry.begin({ sessionKey, sessionId: 'generation-1', resetTriggered: false });
    next.setPhase('memory_flushing');
    try { await expect(execute()).rejects.toThrow('TASK_SCOPE_RUN_STALE'); }
    finally { next.complete(); }
  });
  it('keeps immutable worker origin for a later run on the same child', async () => {
    runtime.worker = { childSessionKey: sessionKey, requesterSessionKey: 'parent', requesterSessionId: 'generation-1',
      workspaceDir: 'D:/project', requesterTaskReference: { taskRef: 'original-task', coordinator: { workspaceId: 'workspace-a', sessionKey: 'parent', sessionGeneration: 'generation-1', bindingRevision: 1 } } };
    const state = await dispatch('taskScope.runState', { ...tuple, runId: 'new-followup' }, backend);
    expect(state).toMatchObject({ active: false, delegation: { parentSessionKey: 'parent', taskReference: { taskRef: 'original-task' } } });
  });
  it('binds isolated execution paths to the project root supplied by the sandbox owner', async () => {
    const effect = vi.fn(async () => 'sandbox write');
    expect(await withSessionTaskScope({ sessionKey, sessionId: 'generation-1', runId,
      workspaceDir: 'D:/sandbox', taskScopeProjectWorkspaceDir: 'D:/project' }, 'write', {}, undefined, effect)).toBe('sandbox write');
    expect(requests[0]).toMatchObject({ workspaceDir: 'D:/sandbox', projectWorkspaceDir: 'D:/project' });
  });
  it('refuses a preflight-only caller that cannot account for actual effects', async () => {
    expect(await runBeforeToolCallHook({ toolName: 'write', params: { path: 'file', content: 'value' } }))
      .toMatchObject({ blocked: true, reason: 'TASK_SCOPE_EFFECT_OWNER_UNAVAILABLE' });
    expect(requests).toHaveLength(0);
  });
  it('admits an actual wrapped tool only after a correlated backend result', async () => {
    const effect = vi.fn(async () => 'written');
    expect(await execute(effect)).toBe('written');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(requests[0]).toMatchObject(tuple);
    await execute(effect);
    expect(requests[1].expectedClaimId).toBe('writer-claim');
  });
  it('carries a read-only task origin through spawn callbacks without exposing the writer claim', async () => {
    await execute(vi.fn(async () => {
      await Promise.resolve();
      const origin = currentSessionTaskRequesterReference();
      expect(origin).toMatchObject({ taskRef: 'business-task', coordinator: { workspaceId: 'workspace-a', sessionKey, sessionGeneration: 'generation-1' } });
      expect(origin).not.toHaveProperty('claim');
      expect(origin).not.toHaveProperty('id');
      return 'written';
    }));
    expect(currentSessionTaskRequesterReference()).toBeUndefined();
  });

  it('does not accept generic RPC calls without an in-flight tool owner', async () => {
    await expect(dispatch('taskScope.admit', { ...tuple, requestId: 'spoof', workspaceDir: 'D:/project', toolName: 'write' }))
      .rejects.toThrow('TASK_SCOPE_RUN_STALE');
    expect(requests).toHaveLength(0);
  });

  it('rejects wrong connections and wrong generations without consuming the pending result', async () => {
    hold = true;
    const effect = vi.fn(async () => 'written');
    const result = execute(effect);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const payload = { ...tuple, requestId: requests[0].requestId, admission: admission(requests[0]) };
    await expect(dispatch('taskScope.admit', { ...requests[0], projectWorkspaceDir: 'D:/forged-project' })).rejects.toThrow('TASK_SCOPE_RUN_STALE');
    expect(await dispatch('taskScope.admit.result', payload, { ...backend, connId: 'other' })).toEqual({ ignored: true });
    expect(await dispatch('taskScope.admit.result', { ...payload, sessionGeneration: 'old' }, backend)).toEqual({ ignored: true });
    expect(effect).not.toHaveBeenCalled();
    release(); await result;
    expect(effect).toHaveBeenCalledTimes(1);
    expect(await dispatch('taskScope.admit.result', payload, backend)).toEqual({ ignored: true });
  });

  it('rechecks generation after an admission result and refuses a reset race', async () => {
    hold = true;
    const effect = vi.fn(async () => 'written');
    const result = execute(effect);
    const rejection = expect(result).rejects.toThrow('TASK_SCOPE_RUN_STALE');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    runtime.generation = 'generation-reset';
    release(); await rejection;
    expect(effect).not.toHaveBeenCalled();
  });

  it('checks caller cancellation before effects even if Main completed admission', async () => {
    hold = true;
    const abort = new AbortController();
    const effect = vi.fn(async () => 'written');
    const result = execute(effect, abort.signal);
    const rejection = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    abort.abort(); release(); await rejection;
    expect(effect).not.toHaveBeenCalled();
  });

  it('fails closed when no unique backend is connected', async () => {
    const effect = vi.fn(async () => 'written');
    context.getApprovalClientConnIds.mockReturnValue([]);
    await expect(execute(effect)).rejects.toThrow('TASK_SCOPE_BRIDGE_UNAVAILABLE');
    context.getApprovalClientConnIds.mockReturnValue(['desktop', 'another-desktop']);
    await expect(execute(effect)).rejects.toThrow('TASK_SCOPE_BRIDGE_UNAVAILABLE');
    expect(effect).not.toHaveBeenCalled();
  });

  it('times out without effects and ignores a late response', async () => {
    vi.useFakeTimers(); hold = true;
    const effect = vi.fn(async () => 'written');
    const result = execute(effect);
    const rejection = expect(result).rejects.toThrow('TASK_SCOPE_BRIDGE_TIMEOUT');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(15_001); await rejection;
    release(); await vi.advanceTimersByTimeAsync(1);
    expect(effect).not.toHaveBeenCalled();
  });

  it('reports in-flight effects and abandoned runs as non-quiescent even when the chat tracker is empty', async () => {
    let finish!: () => void;
    const effect = vi.fn(async () => new Promise<string>((resolve) => { finish = () => resolve('written'); }));
    const result = execute(effect);
    await vi.waitFor(() => expect(effect).toHaveBeenCalledTimes(1));
    active.delete(runId);
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ quiescent: false, inFlightEffects: 1 });
    finish(); await result;
    runtime.abandoned = true;
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ quiescent: false });
    runtime.abandoned = false;
    runtime.processes = [{ sessionKey }];
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ quiescent: false, inFlightProcesses: 1 });
    runtime.processes = [];
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ quiescent: true });
    runtime.supervised = [{ runId: 'removed-process', state: 'exiting', lifecycleExpectedSessionId: tuple.sessionGeneration }];
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ quiescent: false, inFlightProcesses: 1 });
    runtime.supervised[0].state = 'exited';
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ quiescent: true });
    runtime.supervised = [];
    await expect(dispatch('taskScope.runState', tuple)).rejects.toThrow('TASK_SCOPE_BACKEND_REQUIRED');
  });
  it('matches durable process reservations by exact run identity and fails closed without identity', async () => {
    active.clear(); runtime.supervised = [];
    runtime.reservations = [{
      id: 'reservation-old', ownerPid: 1, owner: 'opaque:owner', ports: [], phase: 'observed', createdAt: 1,
      sessionKey, sessionGeneration: tuple.sessionGeneration, runId,
    }];
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({
      processScope: 'run', active: false, quiescent: false, inFlightProcesses: 1,
      managedProcessReservations: { matching: 1, unknownIdentity: 0 },
    });
    expect(await dispatch('taskScope.runState', { ...tuple, runId: 'next-run' }, backend)).toMatchObject({
      active: false, quiescent: true, inFlightProcesses: 0,
      managedProcessReservations: { matching: 0, unknownIdentity: 0 },
    });
    expect(await dispatch('taskScope.runState', { ...tuple, runId: 'selection-probe', processScope: 'session' }, backend)).toMatchObject({
      processScope: 'session', active: false, quiescent: false, inFlightProcesses: 1,
      managedProcessReservations: { matching: 1, unknownIdentity: 0 },
    });
    runtime.reservations[0].sessionGeneration = 'generation-other';
    expect(await dispatch('taskScope.runState', { ...tuple, runId: 'selection-probe', processScope: 'session' }, backend)).toMatchObject({
      quiescent: false, inFlightProcesses: 1,
      managedProcessReservations: { matching: 1, unknownIdentity: 0 },
    });
    runtime.reservations[0].sessionKey = 'agent:main:other-session';
    expect(await dispatch('taskScope.runState', { ...tuple, runId: 'selection-probe', processScope: 'session' }, backend)).toMatchObject({
      quiescent: true, inFlightProcesses: 0,
    });
    for (const phase of ['reserved', 'dispatched', 'observed', 'unknown', 'terminal']) {
      runtime.reservations = [{
        id: `pending-${phase}`, ownerPid: 1, owner: 'opaque:owner', ports: [], phase, createdAt: 1,
        sessionKey, sessionGeneration: tuple.sessionGeneration, runId,
      }];
      expect(await dispatch('taskScope.runState', { ...tuple, runId: 'selection-probe', processScope: 'session' }, backend))
        .toMatchObject({ quiescent: false, inFlightProcesses: 1 });
    }
    runtime.reservations = [{ id: 'legacy-reservation', ownerPid: 1, owner: 'opaque:owner', ports: [], phase: 'unknown', createdAt: 1 }];
    expect(await dispatch('taskScope.runState', { ...tuple, runId: 'selection-probe', processScope: 'session' }, backend)).toMatchObject({
      active: false, quiescent: false, inFlightProcesses: 1,
      managedProcessReservations: { matching: 0, unknownIdentity: 1 },
    });
    await expect(dispatch('taskScope.runState', { ...tuple, processScope: 'invalid' }, backend))
      .rejects.toThrow('TASK_SCOPE_REQUEST_INVALID');
    await expect(dispatch('taskScope.runState', { ...tuple, processScope: 'session' }))
      .rejects.toThrow('TASK_SCOPE_BACKEND_REQUIRED');
  });
  it('keeps a completed run quiescent while a subsequent run owns the session handle', async () => {
    active.clear();
    runtime.supervised = [{ runId: 'next-run', state: 'embedded', lifecycleExpectedSessionId: tuple.sessionGeneration }];
    expect(await dispatch('taskScope.runState', tuple, backend)).toMatchObject({ active: false, quiescent: true });
    expect(await dispatch('taskScope.runState', { ...tuple, runId: 'next-run' }, backend)).toMatchObject({ active: true, quiescent: false });
  });
});
