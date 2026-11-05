// @vitest-environment node
// Main admission integration. Gateway/check readers are injected owner fixtures;
// this suite does not claim actual model, Electron or VerseShell execution.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskLedgerCompletionCheckReceipt, TaskLedgerCompletionCheckpoint } from '../../shared/types/task-ledger';
import type { GatewayOwner } from '../../electron/services/task-ledger-actions';
const state = vi.hoisted(() => ({ root: '', home: '', source: '', profileSource: '', selection: '', activeWorkspace: '', onCheckRead: null as (() => void) | null, checkpoint: null as unknown, check: null as unknown, generation: 'physical-main', running: true }));
vi.mock('@electron/utils/paths', () => ({ getOpenClawConfigDir: () => state.home }));
vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: async () => ({ id: state.activeWorkspace || 'workspace-completion', activeSessionKey: state.selection || 'agent:main:owner', rootPath: state.profileSource || state.source }),
  getWorkspaceRootPathById: async (id: string) => id === 'workspace-completion' ? state.profileSource || state.source : undefined,
}));
vi.mock('@electron/services/versegit-receipt-evidence', () => ({ readCompletedVerseGitTaskCheck: (id: string) => { state.onCheckRead?.(); return id === 'verification-run' ? state.check : null; } }));
vi.mock('@electron/services/git-api', () => ({ createGitApi: () => ({ status: async () => ({ success: false }) }) }));
vi.mock('@electron/services/long-session-resource-reclamation', () => ({
  collectLongSessionResourceInventory: async ({ scope }: { scope: unknown }) => ({
    schema: 'LongSessionResourceInventory/v1', scope, capturedAt: new Date().toISOString(), owners: [],
  }),
}));
import { createTaskLedgerApi } from '../../electron/services/task-ledger-api';
import { createSessionActivityApi } from '../../electron/services/session-activity-api';
import { appendTaskLedgerEvents, loadTaskLedgerSnapshot, readTaskLedgerEvents } from '../../electron/services/task-ledger-service';
import { normalizeScopedTaskReference } from '../../shared/types/task-ledger-reference';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import { taskLedgerDigest } from '../../shared/task-ledger-journal';
import { taskLedgerSessionEpochPath, withTaskLedgerJournalLock } from '../../shared/task-ledger-journal-lock';
import { readTaskCompletionCandidate } from '../../shared/task-ledger-candidate';
import { trackTaskLoopCompletionWorkspace } from '../../openclaw_runtime/src/agents/task-loop-completion-fence';
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from '../../openclaw_runtime/src/config/runtime-snapshot';
import { recordLongTaskCheckpoint } from '../../openclaw_runtime/src/agents/long-task-control/store';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

const scope = { workspaceId: 'workspace-completion', projectId: 'workspace-completion', sessionKey: 'agent:main:owner', sessionGeneration: 'physical-main' } as AutonomySessionScope;
const taskRef = normalizeScopedTaskReference({ owner: 'task-ledger', taskNodeId: 'automatic-task', scope }, scope) as TaskLedgerCompletionCheckpoint['taskRef'];
const claim = { operationId: 'persisted-completion-op', expectedRevision: 1, taskRef, checkpointId: 'existing-loop-checkpoint', verificationRunIds: ['verification-run'] };
const gateway = {
  getStatus: () => ({ state: state.running ? 'running' : 'stopped', pid: 42, connectedAt: 1 }),
  rpc: async (method: string) => {
    if (!state.running) throw new Error('Owner offline');
    if (method === 'runtime.flags.ack') return { childPid: 42, gatewayGeneration: 'gateway-main' };
    if (method === 'session.activitySnapshot') return { snapshot: { session: { sessionId: state.generation, storePath: join(state.home, 'sessions.json') }, policy: { scope: { ...scope, sessionId: state.generation, agentId: 'main' } } } };
    if (method === 'task_loop.completionEvidence') return { scope: { ...scope, sessionGeneration: state.generation }, workspaceRoot: state.source, configSha256: taskLedgerDigest({ config: 'runtime' }), checkpoint: state.checkpoint };
    throw new Error('Unexpected RPC ' + method);
  },
} as unknown as GatewayOwner;
const api = () => createTaskLedgerApi({ gatewayManager: gateway });

beforeEach(async () => {
  state.root = mkdtempSync(join(tmpdir(), 'autonomy-a3-admission-')); state.home = join(state.root, 'home'); state.source = join(state.root, 'source');
  state.generation = 'physical-main'; state.running = true; state.profileSource = ''; state.selection = ''; state.activeWorkspace = ''; state.onCheckRead = null; mkdirSync(state.home); mkdirSync(state.source);
  vi.stubEnv('OPENCLAW_CONFIG_DIR', state.home); vi.stubEnv('OPENCLAW_STATE_DIR', state.home);
  const git = (args: string[]) => execFileSync('git', args, { cwd: state.source, windowsHide: true, stdio: 'pipe' });
  git(['init', '--initial-branch=main']); git(['config', 'user.email', 'agent@example.invalid']); git(['config', 'user.name', 'Agent']);
  writeFileSync(join(state.source, 'source.txt'), 'the exact candidate'); git(['add', '.']); git(['commit', '-m', 'isolated candidate']);
  const now = Date.now(); const acceptance = ['the full acceptance contract'];
  const candidate = readTaskCompletionCandidate(state.source, taskLedgerDigest({ config: 'runtime' }));
  const checkpoint: TaskLedgerCompletionCheckpoint = { owner: 'task-loop', checkpointId: claim.checkpointId, ownerRevision: 'a'.repeat(64), loopRunId: 'actual-owner-loop-fixture', taskRef,
    status: 'complete', evidenceGate: 'pass', selfCheckDecision: 'complete', candidate,
    reviewSource: { state: 'pinned', workspaceRoot: state.source, candidate, capturedAt: now - 1000 },
    acceptanceSha256: taskLedgerDigest(acceptance), taskInputSha256: taskLedgerDigest({ title: 'Automatic business task', description: '' }),
    requiredCheckIds: ['check-full'], verificationChecks: [], workerRunIds: ['worker-run'], verifierRunId: 'reviewer-run', reviewer: { agentId: 'main', runId: 'reviewer-run', sessionKey: 'agent:main:reviewer' }, capturedAt: now - 1000, expiresAt: now + 60_000 };
  const check: TaskLedgerCompletionCheckReceipt = { owner: 'verseshell-host-receipt', receiptId: 'existing-check-receipt', ownerRevision: 'b'.repeat(64), verificationRunId: claim.verificationRunIds[0],
    checkpointId: checkpoint.checkpointId, checkpointRevision: checkpoint.ownerRevision, taskRef, candidate, acceptanceSha256: checkpoint.acceptanceSha256, checkId: 'check-full', reviewer: checkpoint.reviewer, status: 'verified', exitCode: 0,
    artifactRefs: [{ owner: 'verseshell-host-receipt', ref: 'fixture-artifact', sha256: 'c'.repeat(64), verified: true }], capturedAt: now - 500, expiresAt: now + 60_000 };
  state.checkpoint = checkpoint; state.check = check;
  await appendTaskLedgerEvents(scope.workspaceId, [{ id: 'root-created', type: 'node_created', actor: 'system', taskId: taskRef.taskNodeId, payload: { node: {
    id: taskRef.taskNodeId, title: 'Automatic business task', kind: 'task', owner: 'agent', status: 'doing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    metadata: { automaticCompletion: { authority: 'task-ledger', state: 'pending', scope }, acceptance },
  } } }]);
});
afterEach(() => { vi.restoreAllMocks(); clearRuntimeConfigSnapshot(); closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs(); rmSync(state.root, { recursive: true, force: true, maxRetries: 5 }); });

describe('TF-0672 Main completion admission (owner-fixture integration)', () => {
  it('does not let public writers claim the internal runtime actor', async () => {
    const before = await loadTaskLedgerSnapshot(scope.workspaceId);
    await expect(api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'status_changed', actor: 'system',
      payload: { nodeId: taskRef.taskNodeId, status: 'done' } }] })).rejects.toThrow('existing owner');
    const after = await loadTaskLedgerSnapshot(scope.workspaceId);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.eventsCount).toBe(before.eventsCount);
  });

  it('releases the session fence while post-commit owner readback is still waiting', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const originalRpc = gateway.rpc.bind(gateway);
    const rpc = vi.spyOn(gateway, 'rpc').mockImplementation((async (method: string, ...args: unknown[]) => {
      if (method === 'task_loop.completionEvidence') {
        const events = await readTaskLedgerEvents(scope.workspaceId);
        if (events.events.some(event => event.type === 'completion_decided')) { entered(); await gate; }
      }
      return originalRpc(method, ...args as [unknown, number?]);
    }) as never);
    const pending = api().submitCompletion(claim);
    try {
      await reading;
      let acquired = false;
      await withTaskLedgerJournalLock(taskLedgerSessionEpochPath(join(state.home, 'sessions.json')),
        async () => { acquired = true; }, { timeoutMs: 500 });
      expect(acquired).toBe(true);
    } finally {
      release();
      await pending;
      rpc.mockRestore();
    }
  });

  it.each(['manual-done', 'manual-dropped', 'accepted'] as const)('preserves %s business facts against generic automatic replacement and terminal updates', async mode => {
    if (mode === 'accepted') await api().submitCompletion(claim);
    else await api().updateNode({ workspaceId: scope.workspaceId, nodeId: taskRef.taskNodeId,
      patch: { status: mode === 'manual-done' ? 'done' : 'dropped' } });
    const before = (await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0];
    for (const type of ['node_created', 'decision_recorded', 'deviation_logged', 'node_updated', 'node_deleted', 'progress_changed', 'status_changed', 'review_requested', 'review_cleared'] as const) {
      const payload = type === 'node_created' || type === 'decision_recorded' || type === 'deviation_logged'
        ? { node: { id: before.id, title: 'Automatic replacement', kind: 'task' as const, status: 'doing' as const,
          createdAt: before.createdAt, updatedAt: before.updatedAt, metadata: {} } }
        : type === 'node_updated' ? { nodeId: before.id, patch: { status: 'done' as const, metadata: {} } }
          : { nodeId: before.id, status: 'done' as const, progress: 1 };
      await api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type, actor: 'assistant', taskId: 'mismatched-caller-task-id', payload }] });
      expect((await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0], type).toEqual(before);
    }
    const reopened = await api().updateNode({ workspaceId: scope.workspaceId, nodeId: before.id, patch: { status: 'doing' } });
    expect(reopened.snapshot.nodes[0].status).toBe('doing');
    const automatic = await api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_updated', actor: 'assistant', taskId: before.id,
      payload: { nodeId: before.id, patch: { status: 'done' } } }] });
    expect(automatic.snapshot.nodes[0].status).toBe('review');
  });

  it.each(['done', 'dropped'] as const)('does not admit a new completion over an explicit manual %s', async status => {
    await api().updateNode({ workspaceId: scope.workspaceId, nodeId: taskRef.taskNodeId, patch: { status } });
    const before = await loadTaskLedgerSnapshot(scope.workspaceId);
    await expect(api().submitCompletion({ ...claim, operationId: 'after-manual-terminal', expectedRevision: before.eventsCount })).rejects.toThrow();
    expect(await loadTaskLedgerSnapshot(scope.workspaceId)).toMatchObject({ eventsCount: before.eventsCount, nodes: before.nodes });
  });

  it('injects the actual completion owner into the Main session-activity read model', async () => {
    await api().submitCompletion(claim);
    await api().linkSession({ workspaceId: scope.workspaceId, nodeId: taskRef.taskNodeId, sessionKey: scope.sessionKey, relation: 'related' });
    const activity = createSessionActivityApi({ gatewayManager: gateway, terminalManager: { list: () => [] } } as never);
    const accepted = await activity.snapshot({ workspaceId: scope.workspaceId, sessionKey: scope.sessionKey });
    expect(accepted.snapshot.tasks.find(task => task.id === taskRef.taskNodeId)?.status).toBe('completed');
    writeFileSync(join(state.source, 'source.txt'), 'Unverified activity candidate');
    const drifted = await activity.snapshot({ workspaceId: scope.workspaceId, sessionKey: scope.sessionKey });
    expect(drifted.snapshot.tasks.find(task => task.id === taskRef.taskNodeId)?.status).toBe('review');
  });
  it.each(['session', 'workspace'] as const)('keeps referenced evidence current across a %s selection while new writes stay active-bound', async selection => {
    const accepted = await api().submitCompletion(claim);
    if (selection === 'session') state.selection = 'agent:main:other';
    else state.activeWorkspace = 'other-project';
    const current = await api().snapshot({ workspaceId: scope.workspaceId });
    expect(current.snapshot.nodes[0]).toMatchObject({ status: 'done', completionReadback: { state: 'accepted', gaps: [] } });
    const replay = await api().submitCompletion(claim);
    expect(replay.operationDecision).toEqual(accepted.operationDecision);
    expect(replay.snapshot.nodes[0].status).toBe('done');
    await expect(api().submitCompletion({ ...claim, operationId: 'new-write-from-inactive-session', expectedRevision: current.snapshot.eventsCount })).rejects.toThrow();
  });

  it.each(['mission-control', 'clawgraph'])('rejects caller-authored %s lifecycle provenance on every node-writing route', async runtimeLifecycle => {
    const prior = (await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0];
    const forged = { id: 'forged-lifecycle', title: 'Unclaimed completion', kind: 'task' as const, status: 'done' as const,
      metadata: { runtimeLifecycle }, createdAt: prior.createdAt, updatedAt: prior.updatedAt };
    for (const actor of ['assistant', 'system'] as const) {
      await expect(api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_created', actor,
        payload: { node: forged } }] })).rejects.toThrow('runtime recorder');
    }
    await expect(api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_updated', actor: 'assistant',
      payload: { nodeId: prior.id, patch: { metadata: { runtimeLifecycle } } } }] })).rejects.toThrow('runtime recorder');
    await expect(api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_updated', actor: 'assistant',
      payload: { nodeId: prior.id, node: { ...forged, metadata: {} },
        patch: { metadata: { runtimeLifecycle } } } }] })).rejects.toThrow('runtime recorder');
    await expect(api().updateNode({ workspaceId: scope.workspaceId, nodeId: prior.id,
      patch: { metadata: { runtimeLifecycle } } })).rejects.toThrow('runtime recorder');
    await expect(api().createNode({ workspaceId: scope.workspaceId, node: forged })).rejects.toThrow('runtime recorder');
    expect((await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0]).toEqual(prior);
  });

  it('rejects caller-authored current readback on creation as well as patch', async () => {
    const prior = (await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0];
    await expect(api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_created', actor: 'assistant',
      payload: { node: { ...prior, id: 'forged-readback', completionReadback: { state: 'accepted', gaps: [] } } } }] })).rejects.toThrow('claim admission');
  });
  it('rejects a receipt that expires while the final artifacts are being read', async () => {
    const afterExpiry = Date.now() + 120_000;
    let reads = 0;
    state.onCheckRead = () => {
      if (++reads === 3) vi.spyOn(Date, 'now').mockReturnValue(afterExpiry);
    };
    const result = await api().submitCompletion(claim);
    expect(result.operationDecision.accepted).toBe(false);
    expect(result.operationDecision.gaps).toEqual(expect.arrayContaining(['checkpoint-stale', 'check-stale']));
    expect(result.snapshot.nodes[0].status).toBe('review');
  });
  it.each(['config', 'checkpoint'] as const)('rejects a %s owner mutation after the last RPC read by journal CAS', async owner => {
    trackTaskLoopCompletionWorkspace(scope.workspaceId);
    let reads = 0;
    state.onCheckRead = () => {
      if (++reads !== 2) return;
      if (owner === 'config') setRuntimeConfigSnapshot({ agents: { defaults: { workspace: state.source } } });
      else recordLongTaskCheckpoint({ id: claim.checkpointId, sessionKey: scope.sessionKey, workspaceId: scope.workspaceId,
        taskLedgerRootId: taskRef.taskNodeId, trigger: 'guide', metadata: { taskCompletion: state.checkpoint } });
    };
    await expect(api().submitCompletion(claim)).rejects.toThrow('revision conflict');
    const events = (await readTaskLedgerEvents(scope.workspaceId)).events;
    expect(events.some(event => event.type === 'completion_evidence_changed')).toBe(true);
    expect(events.some(event => event.type === 'completion_decided')).toBe(false);
    expect((await loadTaskLedgerSnapshot(scope.workspaceId)).nodes.find(node => node.id === taskRef.taskNodeId)?.status).toBe('doing');
  });
  it('commits only referenced owner facts, replays its historical decision, and invalidates changed source without rewriting history', async () => {
    const result = await api().submitCompletion(claim);
    expect(result.operationDecision).toMatchObject({ accepted: true, driven_by: 'agent', checkpointRevision: 'a'.repeat(64), verificationRevisions: ['b'.repeat(64)] });
    expect(result.snapshot.nodes[0]).toMatchObject({ status: 'done', completionReadback: { state: 'accepted', gaps: [] } });
    const events = (await readTaskLedgerEvents(scope.workspaceId)).events;
    expect(events).toHaveLength(2); expect(events[1]).toMatchObject({ actor: 'assistant', type: 'completion_decided' });
    const replay = await api().submitCompletion(claim); expect(replay.receipt.replayed).toBe(true); expect(replay.operationDecision).toEqual(result.operationDecision);
    writeFileSync(join(state.source, 'source.txt'), 'candidate changed after verification');
    const current = await api().snapshot({ workspaceId: scope.workspaceId });
    expect(current.snapshot.nodes[0]).toMatchObject({ status: 'review', completionReadback: { state: 'invalidated' } });
    expect((await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0].status).toBe('done');
    expect((await readTaskLedgerEvents(scope.workspaceId)).events).toEqual(events);
    const historical = await api().submitCompletion(claim);
    expect(historical.decisionScope).toBe('operation-history');
    expect(historical.operationDecision).toEqual(result.operationDecision);
    expect(historical.snapshot.nodes[0]).toMatchObject({ status: 'review', completionReadback: { state: 'invalidated' } });
    const exported = await api().exportHtml({ workspaceId: scope.workspaceId });
    const payload = readFileSync(exported.path, 'utf8').match(/<script id="ledger-data" type="application\/json">(.*?)<\/script>/su)?.[1];
    expect(payload).toBeDefined();
    expect(JSON.parse(payload!).snapshot.nodes[0]).toMatchObject({ status: 'review', completionReadback: { state: 'invalidated' } });
    state.running = false;
    const offline = await api().submitCompletion(claim); expect(offline.receipt.replayed).toBe(true);
    expect(offline.snapshot.nodes[0]).toMatchObject({ status: 'review', completionReadback: { state: 'unavailable' } });
  }, 60_000);

  it('records a rejected claim when the check owner is missing, regardless of complete/pass text', async () => {
    state.check = null;
    const result = await api().submitCompletion(claim);
    expect(result.operationDecision.accepted).toBe(false); expect(result.operationDecision.gaps).toContain('required-check-coverage-missing');
    expect(result.snapshot.nodes[0].status).toBe('review');
    expect((await readTaskLedgerEvents(scope.workspaceId)).events.at(-1)?.payload.completionDecision?.accepted).toBe(false);
  });

  it('rejects stale generation, caller verdicts, conflicting operation reuse and forged decision CRUD', async () => {
    // Exact bypass shape reproduced against the previously closed 80c0fd41f.
    await expect(api().submitCompletion({ workspaceId: scope.workspaceId, claim: { schema: 'TaskCompletionClaim/v1', taskId: taskRef.taskNodeId,
      candidateDigest: 'a'.repeat(64), generation: 'never-existed-session-generation', verifierDigest: 'b'.repeat(64), effectDigest: 'b'.repeat(64), priorStatus: 'doing' } } as never)).rejects.toThrow('caller verdicts');
    state.generation = 'replacement-main';
    await expect(api().submitCompletion(claim)).rejects.toThrow('sessionGeneration mismatch');
    state.generation = 'physical-main';
    await expect(api().submitCompletion({ ...claim, passed: true } as never)).rejects.toThrow('caller verdicts');
    const result = await api().submitCompletion(claim);
    await expect(api().submitCompletion({ ...claim, verificationRunIds: ['another-run'] })).rejects.toThrow('different request');
    await expect(api().updateNode({ workspaceId: scope.workspaceId, nodeId: taskRef.taskNodeId, patch: { completionDecision: result.operationDecision } })).rejects.toThrow('claim admission');
    await expect(api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'completion_decided', actor: 'assistant', payload: { nodeId: taskRef.taskNodeId, completionDecision: result.operationDecision } }] })).rejects.toThrow('claim admission');
    await api().updateNode({ workspaceId: scope.workspaceId, nodeId: taskRef.taskNodeId, patch: { status: 'done' } });
    const manual = (await api().snapshot({ workspaceId: scope.workspaceId })).snapshot.nodes[0];
    expect(manual.status).toBe('done'); expect(manual.completionDecision).toBeUndefined();
  }, 60_000);

  it('does not allow the older append route to turn a model-authored business terminal into verification', async () => {
    const result = await api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_updated', actor: 'assistant', taskId: taskRef.taskNodeId, payload: { nodeId: taskRef.taskNodeId, patch: { status: 'done', metadata: {} } } }] });
    expect(result.snapshot.nodes[0]).toMatchObject({ status: 'review', metadata: { automaticCompletion: { authority: 'task-ledger' } } });
    expect(result.snapshot.nodes[0].completionDecision).toBeUndefined();
  });

  it.each([undefined, 'user', 'agent'] as const)('requires a claim for an assistant business node even with owner %s', async owner => {
    const now = new Date().toISOString();
    const result = await api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_created', actor: 'assistant', payload: { node: {
      id: 'unclaimed', title: 'Unclaimed model terminal', kind: 'task', owner, status: 'done', createdAt: now, updatedAt: now,
    } } }] });
    expect(result.snapshot.nodes.find(node => node.id === 'unclaimed')).toMatchObject({ status: 'review', metadata: { automaticCompletion: { authority: 'task-ledger' } } });
  });

  it.each(['node_updated', 'status_changed', 'review_cleared'] as const)('cannot use %s to automatically finish an existing manual business task', async type => {
    const created = await api().createNode({ workspaceId: scope.workspaceId, node: { title: 'Manual business task', kind: 'task' } });
    const nodeId = created.snapshot.nodes.find(node => node.title === 'Manual business task')!.id;
    const result = await api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type, actor: 'assistant', taskId: nodeId,
      payload: { nodeId, ...(type === 'node_updated' ? { patch: { status: 'done' } } : { status: 'done' }) } }] });
    expect(result.snapshot.nodes.find(node => node.id === nodeId)).toMatchObject({ status: 'review', metadata: { automaticCompletion: { authority: 'task-ledger' } } });
    const manual = await api().updateNode({ workspaceId: scope.workspaceId, nodeId, patch: { status: 'done' } });
    expect(manual.snapshot.nodes.find(node => node.id === nodeId)?.status).toBe('done');
  });

  it.each(['node_created', 'decision_recorded', 'deviation_logged', 'node_updated'] as const)('cannot recast a business task through %s to erase completion admission', async type => {
    const prior = (await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0];
    const recast = type === 'node_updated'
      ? { nodeId: prior.id, patch: { kind: 'check' as const, metadata: {} } }
      : { node: { id: prior.id, title: prior.title, createdAt: prior.createdAt, updatedAt: prior.updatedAt,
        status: prior.status, kind: 'check' as const, metadata: {} } };
    const result = await api().appendEvents({ workspaceId: scope.workspaceId, events: [
      { type, actor: 'assistant', taskId: prior.id, payload: recast },
      { type: 'node_updated', actor: 'assistant', taskId: prior.id, payload: { nodeId: prior.id, patch: { kind: 'task', status: 'done', metadata: {} } } },
    ] });
    expect(result.snapshot.nodes[0]).toMatchObject({ kind: 'task', status: 'review', metadata: { automaticCompletion: { authority: 'task-ledger' } } });
    const manual = await api().updateNode({ workspaceId: scope.workspaceId, nodeId: prior.id, patch: { kind: 'check', status: 'done' } });
    expect(manual.snapshot.nodes[0]).toMatchObject({ kind: 'check', status: 'done' });
  });

  it('keeps a turn check done without letting an automatic patch convert it into accepted business done', async () => {
    const created = await api().createNode({ workspaceId: scope.workspaceId, node: { title: 'Turn fact', kind: 'check', status: 'done' } });
    const check = created.snapshot.nodes.find(node => node.title === 'Turn fact')!;
    const updated = await api().appendEvents({ workspaceId: scope.workspaceId, events: [{ type: 'node_updated', actor: 'assistant', taskId: check.id,
      payload: { nodeId: check.id, patch: { kind: 'task', status: 'done' } } }] });
    expect(updated.snapshot.nodes.find(node => node.id === check.id)).toMatchObject({ kind: 'check', status: 'done' });
  });

  it.each(['manual', 'accepted'] as const)('rejects a later attempt without undoing a %s completion', async completedBy => {
    if (completedBy === 'accepted') await api().submitCompletion(claim);
    else await api().updateNode({ workspaceId: scope.workspaceId, nodeId: taskRef.taskNodeId, patch: { status: 'done' } });
    const before = (await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0];
    const current = await loadTaskLedgerSnapshot(scope.workspaceId);
    const attempt = api().submitCompletion({ ...claim, operationId: 'later-invalid-attempt', expectedRevision: current.eventsCount, checkpointId: 'missing-checkpoint' });
    if (completedBy === 'manual') {
      await expect(attempt).rejects.toThrow('manually completed');
      expect((await readTaskLedgerEvents(scope.workspaceId)).events).toHaveLength(current.eventsCount);
    } else {
      const rejected = await attempt;
      expect(rejected.operationDecision.accepted).toBe(false);
      expect((await readTaskLedgerEvents(scope.workspaceId)).events.at(-1)?.payload.completionDecision?.accepted).toBe(false);
    }
    expect((await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0]).toEqual(before);
  });

  it('fences an active workspace root replacement after the last owner reference read and before append', async () => {
    const replacement = join(state.root, 'replacement-source'); mkdirSync(replacement);
    let reads = 0;
    state.onCheckRead = () => { if (++reads === 2) state.profileSource = replacement; };
    await expect(api().submitCompletion(claim)).rejects.toThrow('workspace root changed before append');
    expect((await readTaskLedgerEvents(scope.workspaceId)).events).toHaveLength(1);
    expect((await loadTaskLedgerSnapshot(scope.workspaceId)).nodes[0].status).toBe('doing');
  });
});
