// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getCallGatewayMock, getSessionsSpawnTool, setSessionsSpawnConfigOverride } from '../../openclaw_runtime/src/agents/openclaw-tools.subagents.sessions-spawn.test-harness';
import { spawnSubagentDirect } from '../../openclaw_runtime/src/agents/subagent-spawn';
import { loadSessionStore } from '../../openclaw_runtime/src/config/sessions';
import { emitAgentEvent } from '../../openclaw_runtime/src/infra/agent-events';
import { getSubagentRunByRunId, resetSubagentRegistryForTests, testing } from '../../openclaw_runtime/src/agents/subagent-registry';
import { runOrchestrationObserved } from '../../openclaw_runtime/src/agents/orchestrator-run-observed';
import { synthesizeOrchestrationResult } from '../../openclaw_runtime/src/agents/orchestration-synthesizer';
import { subagentRuns } from '../../openclaw_runtime/src/agents/subagent-registry-memory';
import { openOpenClawStateDatabase, closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { closeOpenClawAgentDatabasesForTest } from '../../openclaw_runtime/src/state/openclaw-agent-db';

const parent = 'agent:main:main';
const config = { agents: { teams: undefined, defaults: { model: { primary: 'example/test-model' }, subagents: { maxChildrenPerAgent: 1 } } },
  session: { mainKey: 'main', scope: 'per-sender' as const } };

describe('orchestration waves follow actual registry terminal state', () => {
  const dispatched: Array<{ runId: string; childSessionKey: string }> = [];
  beforeEach(async () => {
    resetSubagentRegistryForTests({ persist: false });
    dispatched.length = 0;
    setSessionsSpawnConfigOverride(config);
    await getSessionsSpawnTool({ agentSessionKey: parent });
    loadSessionStore('test')[parent] = { sessionId: 'parent-generation-one', updatedAt: Date.now() };
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') {
        dispatched.push({ runId: params.idempotencyKey, childSessionKey: params.sessionKey });
        return { status: 'accepted', runId: params.idempotencyKey };
      }
      if (method === 'agent.wait') return { status: 'pending' };
      return { ok: true };
    });
  });
  afterEach(() => { resetSubagentRegistryForTests({ persist: false }); closeOpenClawAgentDatabasesForTest(); closeOpenClawStateDatabase(); vi.unstubAllEnvs(); });

  async function start() {
    const lifecycle: string[] = [];
    const result = await runOrchestrationObserved({ task: 'edit shared module twice', orchestrationRunId: 'wave-test',
      maxWorkers: 2, includeVerifier: false, cfg: config,
      workers: [
        { roleName: 'implementer', task: 'first edit', writeSet: ['shared.ts'] },
        { roleName: 'docs-writer', task: 'second edit', writeSet: ['shared.ts'] },
      ],
    }, { agentSessionKey: parent }, { spawn: (params, context) => spawnSubagentDirect(
      { ...params, lightContext: true, expectsCompletionMessage: false }, context) }, undefined,
    event => { lifecycle.push(event.status); });
    expect(lifecycle).not.toContain('completed');
    return result;
  }

  it('returns queued nodes promptly and dispatches the next wave exactly once after a terminal event', async () => {
    const result = await start();
    expect(result.schedulerMetrics.completed).toBe(0);
    await expect.poll(() => dispatched.length).toBe(1);
    expect(result.graphStatus).toBe('running');
    expect(result.spawnedRunIds).toHaveLength(2);
    const second = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
    expect(getSubagentRunByRunId(second)?.execution?.status).toBe('queued');
    const first = dispatched[0];
    emitAgentEvent({ runId: first.runId, sessionKey: first.childSessionKey, stream: 'lifecycle',
      data: { phase: 'end', endedAt: Date.now() } });
    await expect.poll(() => dispatched.length).toBe(2);
    emitAgentEvent({ runId: first.runId, sessionKey: first.childSessionKey, stream: 'lifecycle',
      data: { phase: 'end', endedAt: Date.now() } });
    await testing.sweepOnceForTests();
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1].runId).toBe(second);
  });

  it('does not project an accepted spawn bundle as a verified result', async () => {
    const result = await start();
    expect(result.resultBundle.status).toBe('pending');
    const synthesis = synthesizeOrchestrationResult({ bundle: result.resultBundle, blackboardSummary: result.blackboardSummary });
    expect(synthesis.status).toBe('pending');
    expect(synthesis.summary).not.toContain('Verified result');
  });

  it('returns owner-backed handoff waves before a submission-side output capture settles', async () => {
    const cfg = { ...config, runtime: { orchestration: { handoffArtifacts: 'on' as const } } };
    setSessionsSpawnConfigOverride(cfg);
    let finishCapture!: (value: { status: 'captured'; output: string; capturedAt: number; source: 'injected_test_capture' }) => void;
    const capture = new Promise<{ status: 'captured'; output: string; capturedAt: number; source: 'injected_test_capture' }>(resolve => { finishCapture = resolve; });
    const pending = runOrchestrationObserved({ task: 'pass a plan to the next worker', orchestrationRunId: 'handoff-wave',
      maxWorkers: 2, includeVerifier: false, cfg, graphMode: 'staged', workers: [
        { roleName: 'planner', task: 'plan the change' }, { roleName: 'implementer', task: 'use the frozen plan', writeSet: ['shared.ts'] },
      ],
    }, { agentSessionKey: parent }, { spawn: (params, context) => spawnSubagentDirect(
      { ...params, lightContext: true, expectsCompletionMessage: false }, context), captureHandoffOutput: () => capture });
    try {
      await expect.poll(() => dispatched.length).toBe(1);
      const result = await Promise.race([pending, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 2000))]);
      expect(result?.spawnedRunIds).toHaveLength(2);
      expect(result?.handoffState).toBe('idle');
      expect(result?.schedulerMetrics.completed).toBe(0);
    } finally {
      finishCapture({ status: 'captured', output: 'scripted submission capture', capturedAt: Date.now(), source: 'injected_test_capture' });
      await pending;
    }
  });

  async function startHandoff() {
    const cfg = { ...config, runtime: { orchestration: { handoffArtifacts: 'on' as const } } };
    setSessionsSpawnConfigOverride(cfg);
    return await runOrchestrationObserved({ task: 'handoff the owner result', orchestrationRunId: 'handoff-result',
      maxWorkers: 2, includeVerifier: false, cfg, graphMode: 'staged', workers: [
        { roleName: 'planner', task: 'plan the change' }, { roleName: 'implementer', task: 'use the frozen result', writeSet: ['shared.ts'] },
      ],
    }, { agentSessionKey: parent }, { spawn: (params, context) => spawnSubagentDirect(
      { ...params, lightContext: true, expectsCompletionMessage: false }, context) });
  }

  it.each([true, false])('binds only an available frozen owner handoff (available=%s)', async available => {
    const prompts: string[] = [];
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') { dispatched.push({ runId: params.idempotencyKey, childSessionKey: params.sessionKey }); prompts.push(params.extraSystemPrompt); return { status: 'accepted', runId: params.idempotencyKey }; }
      if (method === 'agent.wait') return { status: 'pending' };
      return { ok: true };
    });
    const result = await startHandoff();
    await expect.poll(() => dispatched.length).toBe(1);
    const first = dispatched[0];
    // The fixture supplies captured content in the original registry owner.
    subagentRuns.get(first.runId)!.completion = { required: false, resultText: available ? 'OWNER-FROZEN-R1-SIGNAL' : null,
      capturedAt: Date.now(), fallbackResultText: null, fallbackCapturedAt: Date.now() };
    emitAgentEvent({ runId: first.runId, sessionKey: first.childSessionKey, stream: 'lifecycle', data: { phase: 'end', endedAt: Date.now() } });
    const secondId = result.outcomes.find(outcome => outcome.roleName === 'implementer')!.spawn.result!.runId!;
    if (available) {
      await expect.poll(() => dispatched.length).toBe(2);
      expect(prompts[1]).toContain('OWNER-FROZEN-R1-SIGNAL');
      expect(getSubagentRunByRunId(secondId)?.orchestration?.handoffArtifacts).toMatchObject([{ state: 'ready', source: 'subagent_registry_completion' }]);
    } else {
      await expect.poll(() => getSubagentRunByRunId(secondId)?.execution?.status).toBe('terminal');
      expect(dispatched).toHaveLength(1);
      expect(getSubagentRunByRunId(secondId)?.outcome?.status).toBe('error');
    }
  });

  it('keeps successors queued while the previous accepted run has no terminal owner receipt', async () => {
    const result = await start();
    await testing.sweepOnceForTests();
    expect(dispatched).toHaveLength(1);
    const second = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
    expect(getSubagentRunByRunId(second)).toMatchObject({ execution: { status: 'queued' } });
  });

  it('rejects queued work when the coordinator generation changes', async () => {
    const result = await start();
    await expect.poll(() => dispatched.length).toBe(1);
    loadSessionStore('test')[parent] = { sessionId: 'parent-generation-two', updatedAt: Date.now() };
    emitAgentEvent({ runId: dispatched[0].runId, sessionKey: dispatched[0].childSessionKey, stream: 'lifecycle',
      data: { phase: 'end', endedAt: Date.now() } });
    const second = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
    await expect.poll(() => getSubagentRunByRunId(second)?.outcome?.status).toBe('error');
    expect(dispatched).toHaveLength(1);
  });

  it('does not dispatch a successor after cancellation of its predecessor', async () => {
    const result = await start();
    await expect.poll(() => dispatched.length).toBe(1);
    emitAgentEvent({ runId: dispatched[0].runId, sessionKey: dispatched[0].childSessionKey, stream: 'lifecycle',
      data: { phase: 'end', endedAt: Date.now(), stopReason: 'aborted' } });
    const second = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
    await expect.poll(() => getSubagentRunByRunId(dispatched[0].runId)?.outcome?.status).toBe('error');
    await expect.poll(() => getSubagentRunByRunId(second)?.outcome?.status).toBe('error');
    expect(dispatched).toHaveLength(1);
  });

  it('waits for agent.wait owner completion as well as lifecycle events', async () => {
    let finishFirst!: (value: unknown) => void;
    const terminal = new Promise(resolve => { finishFirst = resolve; });
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') {
        dispatched.push({ runId: params.idempotencyKey, childSessionKey: params.sessionKey });
        return { status: 'accepted', runId: params.idempotencyKey };
      }
      if (method === 'agent.wait') return dispatched[0]?.runId === params.runId ? terminal : { status: 'pending' };
      return { ok: true };
    });
    await start();
    await expect.poll(() => dispatched.length).toBe(1);
    finishFirst({ status: 'ok', startedAt: Date.now() - 10, endedAt: Date.now() });
    await expect.poll(() => dispatched.length).toBe(2);
  });

  it('retains a lost dispatch acknowledgement without starting later waves', async () => {
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') {
        dispatched.push({ runId: params.idempotencyKey, childSessionKey: params.sessionKey });
        throw new Error('agent-injected lost acknowledgement');
      }
      return { status: 'pending' };
    });
    const result = await start();
    await testing.sweepOnceForTests();
    expect(dispatched).toHaveLength(1);
    expect(getSubagentRunByRunId(dispatched[0].runId)?.dispatchPending).toBe(true);
    expect(getSubagentRunByRunId(dispatched[0].runId)?.endedAt).toBeUndefined();
    const second = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
    expect(getSubagentRunByRunId(second)?.execution?.status).toBe('queued');
  });

  it('dispatches a queued native Git worker through its registered owner base', async () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'r4-native-wave-')), repository = path.join(fixture, 'repo'); mkdirSync(repository);
    vi.stubEnv('OPENCLAW_STATE_DIR', path.join(fixture, 'state'));
    const nativeCfg = { ...config, runtime: { coding: { worktree: { backend: 'git' as const } } } } as Parameters<typeof setSessionsSpawnConfigOverride>[0];
    setSessionsSpawnConfigOverride(nativeCfg);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', windowsHide: true }).trim();
    try {
      git('init', '-q'); writeFileSync(path.join(repository, '.gitignore'), '.openclaw/\n'); writeFileSync(path.join(repository, 'shared.ts'), 'export const value=1;\n');
      git('add', '.'); git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'native wave fixture');
      const result = await runOrchestrationObserved({ task: 'check native queued worktree ownership', orchestrationRunId: 'native-owner-wave',
        cfg: nativeCfg, maxWorkers: 2, includeVerifier: false, workers: [
          { roleName: 'implementer', task: 'first native task', writeSet: ['shared.ts'], isolation: 'worktree' },
          { roleName: 'docs-writer', task: 'second native task', writeSet: ['shared.ts'], isolation: 'worktree' },
        ] }, { agentSessionKey: parent, workspaceDir: repository }, { spawn: (params, context) => spawnSubagentDirect(
        { ...params, lightContext: true, expectsCompletionMessage: false }, context) });
      await expect.poll(() => dispatched.length, { timeout: 15_000 }).toBe(1);
      const secondId = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
      const queued = getSubagentRunByRunId(secondId)!;
      expect(queued.execution?.status).toBe('queued'); expect(queued.workspaceDir).not.toBe(repository);
      const { resolveExecutionCheckout } = await import('../../openclaw_runtime/src/agents/worktree-service');
      const owner = resolveExecutionCheckout(queued.workspaceDir!);
      expect(owner.worktreeId).toBe(queued.orchestration?.worktreeId); expect(owner.basis.generation).toBe(queued.orchestration?.worktreeGeneration);
      const first = dispatched[0]; emitAgentEvent({ runId: first.runId, sessionKey: first.childSessionKey, stream: 'lifecycle', data: { phase: 'end', endedAt: Date.now() } });
      await expect.poll(() => dispatched.length, { timeout: 15_000 }).toBe(2); expect(dispatched[1].runId).toBe(secondId);
      const evidence = process.env.CLAWX_R4_EVIDENCE_DIR;
      if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(path.join(evidence, 'native-queued-worker-owner.json'), JSON.stringify({
        driven_by: 'agent', actor: 'r4-native-wave-test', nativeGit: true, agentRPC: 'injected',
        workspace: queued.workspaceDir, ownerBase: owner.baseRoot, worktreeId: owner.worktreeId, generation: owner.basis.generation, dispatched,
      }, null, 2)); }
    } finally { resetSubagentRegistryForTests({ persist: false }); closeOpenClawAgentDatabasesForTest(); closeOpenClawStateDatabase(); rmSync(fixture, { recursive: true, force: true }); }
  });
  it.each(['ready', 'dirty', 'wrong-directory', 'redirected-directory'] as const)('checks the frozen candidate rather than inherited worker identity for a queued verifier (%s)', async state => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'r4-queued-verifier-')), repository = path.join(fixture, 'repo'); mkdirSync(repository);
    vi.stubEnv('OPENCLAW_STATE_DIR', path.join(fixture, 'state'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8', windowsHide: true }).trim();
    try {
      git('init', '-q'); writeFileSync(path.join(repository, '.gitignore'), '.openclaw/\n'); writeFileSync(path.join(repository, 'out.txt'), 'base');
      git('add', '.'); git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'verifier fixture');
      const { createWorktreeService } = await import('../../openclaw_runtime/src/agents/worktree-service');
      const { freezeOrchestrationWorktreeCandidate } = await import('../../openclaw_runtime/src/agents/orchestration-worktree-merge');
      const service = createWorktreeService(repository, { backend: 'git' }), worker = service.create('worker', { writeSet: ['out.txt'] });
      writeFileSync(path.join(worker.root, 'out.txt'), 'candidate result');
      const frozen = freezeOrchestrationWorktreeCandidate({ baseRoot: repository, workers: [{ taskNodeId: 'candidate-task',
        worktreeId: worker.id, worktreeGeneration: worker.generation, declaredWriteSet: ['out.txt'] }] });
      if (frozen.status !== 'frozen') throw new Error(JSON.stringify(frozen));
      const result = await start(); await expect.poll(() => dispatched.length).toBe(1);
      const runId = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
      const queued = subagentRuns.get(runId)!;
      queued.workspaceDir = state === 'wrong-directory' ? worker.root : frozen.materializedPath;
      if (state === 'redirected-directory') {
        queued.workspaceDir = frozen.materializedPath + '-alias'; symlinkSync(frozen.materializedPath, queued.workspaceDir, 'junction');
      }
      queued.orchestration = { ...queued.orchestration!, phase: 'verifier', isVerifier: true, isolation: 'worktree',
        worktreeBackend: 'git', worktreeId: worker.id, worktreeGeneration: worker.generation,
        worktreeVerificationCandidate: { manifest: frozen.manifest, materializedPath: frozen.materializedPath, baseRoot: repository } };
      if (state === 'dirty') writeFileSync(path.join(frozen.materializedPath, 'out.txt'), 'unexpected candidate drift');
      const { dispatchQueuedSubagentRun } = await import('../../openclaw_runtime/src/agents/subagent-spawn');
      const dispatchedResult = await dispatchQueuedSubagentRun(queued);
      if (state === 'ready') { expect(dispatchedResult).toMatchObject({ status: 'accepted', runId }); expect(dispatched).toHaveLength(2); }
      else { expect(dispatchedResult).toMatchObject({ status: 'rejected', error: expect.stringContaining('verification candidate expired') }); expect(dispatched).toHaveLength(1); }
      const evidence = process.env.CLAWX_R4_EVIDENCE_DIR;
      if (evidence) { mkdirSync(evidence, { recursive: true }); writeFileSync(path.join(evidence, 'queued-verifier-' + state + '.json'), JSON.stringify({
        driven_by: 'agent', actor: 'r4-queued-verifier-test', nativeGit: true, agentRPC: 'injected', state,
        candidate: frozen, executionDirectory: queued.workspaceDir, inheritedWorkerId: worker.id, dispatchedResult,
      }, null, 2)); }
    } finally { resetSubagentRegistryForTests({ persist: false }); closeOpenClawAgentDatabasesForTest(); closeOpenClawStateDatabase(); rmSync(fixture, { recursive: true, force: true }); }
  });
  it('rejects a queued payload whose child identity no longer matches its owner row', async () => {
    const result = await start();
    await expect.poll(() => dispatched.length).toBe(1);
    const second = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
    subagentRuns.get(second)!.queuedDispatch!.params.sessionKey = 'agent:other:unrelated';
    emitAgentEvent({ runId: dispatched[0].runId, sessionKey: dispatched[0].childSessionKey, stream: 'lifecycle',
      data: { phase: 'end', endedAt: Date.now() } });
    await expect.poll(() => getSubagentRunByRunId(second)?.outcome?.status).toBe('error');
    expect(dispatched).toHaveLength(1);
  });

  it('restores the queued wave from owner SQLite and advances only after the prior run ends', async () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', mkdtempSync(path.join(tmpdir(), 'autonomy-wave-owner-')));
    testing.setDepsForTest({ callGateway: getCallGatewayMock(), getRuntimeConfig: () => config,
      ensureContextEnginesInitialized: () => {}, ensureRuntimePluginsLoaded: () => {},
      captureSubagentCompletionReply: async () => undefined, cleanupBrowserSessionsForLifecycleEnd: async () => {},
      runSubagentAnnounceFlow: async () => true,
      resolveContextEngine: async () => ({ info: { id: 'test', name: 'Test' },
        assemble: async ({ messages }) => ({ messages, estimatedTokens: 0 }),
        compact: async () => ({ ok: true, compacted: false }), ingest: async () => ({ ingested: false }) }),
    });
    const result = await start();
    await expect.poll(() => dispatched.length).toBe(1);
    await expect.poll(() => getSubagentRunByRunId(dispatched[0].runId)?.execution?.status).toBe('running');
    const first = dispatched[0];
    const second = result.outcomes.find(outcome => outcome.roleName === 'docs-writer')!.spawn.result!.runId!;
    const db = openOpenClawStateDatabase();
    const before = db.db.prepare('SELECT run_id, ended_at, payload_json FROM subagent_runs').all();
    expect(before).toHaveLength(2);
    resetSubagentRegistryForTests({ persist: false });
    // The restored owner starts its lifecycle listener through the normal init path.
    const { initSubagentRegistry } = await import('../../openclaw_runtime/src/agents/subagent-registry');
    initSubagentRegistry();
    expect(subagentRuns.size).toBe(2);
    await testing.sweepOnceForTests();
    expect(dispatched).toHaveLength(1);
    expect(getSubagentRunByRunId(second)?.execution?.status).toBe('queued');
    emitAgentEvent({ runId: first.runId, sessionKey: first.childSessionKey, stream: 'lifecycle',
      data: { phase: 'end', endedAt: Date.now() } });
    await expect.poll(() => getSubagentRunByRunId(second)?.execution?.status).toBe('running');
    expect(dispatched).toHaveLength(2);
    const after = db.db.prepare('SELECT run_id, ended_at, payload_json FROM subagent_runs').all();
    db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    closeOpenClawStateDatabase();
    const evidence = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission', 'waves-' + randomUUID());
    mkdirSync(evidence, { recursive: true });
    copyFileSync(db.path, path.join(evidence, 'owner.sqlite'));
    writeFileSync(path.join(evidence, 'owner.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-wave-test',
      before, after, dispatched, mode: 'real owner registry and SQLite; injected agent RPC and lifecycle events',
    }, null, 2) + '\n');
  });
});
