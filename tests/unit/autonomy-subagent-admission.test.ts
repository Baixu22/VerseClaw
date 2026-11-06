// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getCallGatewayMock, getSessionsSpawnTool, setSessionsSpawnConfigOverride,
} from '../../openclaw_runtime/src/agents/openclaw-tools.subagents.sessions-spawn.test-harness';
import { spawnSubagentDirect, testing as spawnTesting } from '../../openclaw_runtime/src/agents/subagent-spawn';
import { loadSessionStore } from '../../openclaw_runtime/src/config/sessions';
import {
  addSubagentRunForTests, countActiveRunsForSession, getSubagentRunByRunId, listSubagentRunsForController,
  markSubagentRunTerminated, resetSubagentRegistryForTests, testing,
} from '../../openclaw_runtime/src/agents/subagent-registry';
import { subagentRuns } from '../../openclaw_runtime/src/agents/subagent-registry-memory';
import { loadSubagentRegistryFromSqlite } from '../../openclaw_runtime/src/agents/subagent-registry.store.sqlite';
import { restoreSubagentRunsFromDisk } from '../../openclaw_runtime/src/agents/subagent-registry-state';
import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';

const parent = 'agent:main:main';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('real subagent spawn reservation lifecycle', () => {
  beforeEach(async () => {
    resetSubagentRegistryForTests({ persist: false });
    setSessionsSpawnConfigOverride({ agents: { defaults: {
      model: { primary: 'example/test-model' }, subagents: { maxChildrenPerAgent: 1 },
    } }, session: { mainKey: 'main', scope: 'per-sender' } });
    await getSessionsSpawnTool({ agentSessionKey: parent });
  });
  afterEach(() => { resetSubagentRegistryForTests({ persist: false }); });

  it('inherits the logical workspace from the parent owner before agent dispatch', async () => {
    const store = loadSessionStore('test');
    store[parent] = { sessionId: 'parent-generation', updatedAt: Date.now(), workspaceId: 'owner-project' };
    spawnTesting.setDepsForTest({
      getRuntimeConfig: () => ({ agents: { defaults: { model: { primary: 'example/test-model' } } }, session: { mainKey: 'main', scope: 'per-sender' } }),
      callGateway: getCallGatewayMock(), getGlobalHookRunner: () => null,
      updateSessionStore: async (_storePath, mutator) => mutator(store),
    });
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') {
        expect(store[params.sessionKey].workspaceId).toBe('owner-project');
        return { status: 'accepted', runId: params.idempotencyKey };
      }
      return { status: 'pending', ok: true };
    });
    const result = await spawnSubagentDirect({ task: 'inherit budget identity', lightContext: true }, { agentSessionKey: parent, workspaceDir: '/different-physical-checkout' });
    expect(result.status).toBe('accepted');
    expect(store[result.childSessionKey!].workspaceId).toBe('owner-project');
  });

  it('counts an in-flight dispatch and keeps capacity after acceptance until owner termination', async () => {
    const reached = deferred<Record<string, string>>();
    const accept = deferred<{ runId: string; status: string }>();
    let dispatches = 0;
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') { dispatches++; reached.resolve(params); return accept.promise; }
      if (method === 'agent.wait') return { status: 'pending' };
      return { ok: true };
    });
    const first = spawnSubagentDirect({ task: 'first', lightContext: true }, { agentSessionKey: parent });
    const secondPending = spawnSubagentDirect({ task: 'second', lightContext: true }, { agentSessionKey: parent });
    const params = await reached.promise;
    expect(countActiveRunsForSession(parent)).toBe(1);
    expect(getSubagentRunByRunId(params.idempotencyKey)).toMatchObject({ dispatchPending: true, execution: { status: 'pending' } });
    // Preparation is asynchronous; either caller may win the reservation.
    const rejected = await Promise.race([first, secondPending]);
    expect(rejected.status).toBe('forbidden');
    expect(dispatches).toBe(1);
    accept.resolve({ runId: params.idempotencyKey, status: 'accepted' });
    expect((await Promise.all([first, secondPending])).map(value => value.status).sort()).toEqual(['accepted', 'forbidden']);
    expect(getSubagentRunByRunId(params.idempotencyKey)?.dispatchPending).toBeUndefined();
    expect(countActiveRunsForSession(parent)).toBe(1);
    markSubagentRunTerminated({ runId: params.idempotencyKey });
    expect(countActiveRunsForSession(parent)).toBe(0);
  });

  it('does not resurrect a child cancelled before its acceptance reply', async () => {
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') {
        markSubagentRunTerminated({ runId: params.idempotencyKey });
        return { status: 'accepted', runId: params.idempotencyKey };
      }
      if (method === 'agent.wait') return { status: 'pending' };
      return { ok: true };
    });
    const result = await spawnSubagentDirect({ task: 'fast cancellation', lightContext: true }, { agentSessionKey: parent });
    expect(result.status).toBe('accepted');
    expect(countActiveRunsForSession(parent)).toBe(0);
    expect(getSubagentRunByRunId(result.runId!)?.execution?.status).toBe('terminal');
  });

  it('preserves another session when a dispatch response collides with its run id', async () => {
    addSubagentRunForTests({ runId: 'existing-other-run', childSessionKey: 'agent:other:child',
      controllerSessionKey: 'agent:other:main', requesterSessionKey: 'agent:other:main',
      requesterDisplayKey: 'agent:other:main', task: 'retained task', cleanup: 'keep', createdAt: Date.now() });
    getCallGatewayMock().mockImplementation(async ({ method }) => {
      if (method === 'agent') return { status: 'accepted', runId: 'existing-other-run' };
      return { ok: true, deleted: true };
    });
    const result = await spawnSubagentDirect({ task: 'collision', lightContext: true }, { agentSessionKey: parent });
    expect(result.status).toBe('error');
    expect(getSubagentRunByRunId('existing-other-run')?.childSessionKey).toBe('agent:other:child');
    expect(countActiveRunsForSession(parent)).toBe(0);
  });

  it.each(['timeout', 'error'])('retains capacity for %s without a terminal receipt past the configured deadline', async (status) => {
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') return { runId: params.idempotencyKey, status: 'accepted' };
      if (method === 'agent.wait') return { status, error: 'agent-injected unconfirmed wait', startedAt: Date.now() - 10_000 };
      return { ok: true };
    });
    const result = await spawnSubagentDirect({ task: 'unknown execution', runTimeoutSeconds: 1, lightContext: true }, { agentSessionKey: parent });
    expect(result.status).toBe('accepted');
    await expect.poll(() => getSubagentRunByRunId(result.runId!)?.execution?.status).toBe('interrupted');
    expect(getSubagentRunByRunId(result.runId!)?.endedAt).toBeUndefined();
    expect(countActiveRunsForSession(parent)).toBe(1);
  });

  it('does not let an orphan sweep release an old run without execution exit evidence', async () => {
    getCallGatewayMock().mockImplementation(async ({ method, params }) => {
      if (method === 'agent') return { runId: params.idempotencyKey, status: 'accepted' };
      if (method === 'agent.wait') return { status: 'pending' };
      return { ok: true };
    });
    const result = await spawnSubagentDirect({ task: 'lost local context', lightContext: true }, { agentSessionKey: parent });
    const row = subagentRuns.get(result.runId!)!;
    row.startedAt = row.createdAt = Date.now() - 3 * 60 * 60 * 1000;
    await testing.sweepOnceForTests();
    expect(getSubagentRunByRunId(result.runId!)?.execution?.status).toBe('interrupted');
    expect(getSubagentRunByRunId(result.runId!)?.endedAt).toBeUndefined();
    expect(countActiveRunsForSession(parent)).toBe(1);
    markSubagentRunTerminated({ runId: result.runId });
    expect(countActiveRunsForSession(parent)).toBe(0);
  });

  it('retains unknown dispatch when cancellation is unconfirmed, including a sweep', async () => {
    getCallGatewayMock().mockImplementation(async ({ method }) => {
      if (method === 'agent' || method === 'sessions.delete') throw new Error('agent-injected transport unavailable');
      return { ok: true };
    });
    const result = await spawnSubagentDirect({ task: 'unknown dispatch', lightContext: true }, { agentSessionKey: parent });
    expect(result.status).toBe('error');
    expect(countActiveRunsForSession(parent)).toBe(1);
    expect(listSubagentRunsForController(parent)).toMatchObject([{ dispatchPending: true }]);
    await testing.sweepOnceForTests();
    expect(countActiveRunsForSession(parent)).toBe(1);
    markSubagentRunTerminated({ runId: result.runId });
    expect(countActiveRunsForSession(parent)).toBe(0);
  });

  it.each([true, false])('releases failed dispatch only for deleted=true (deleted=%s)', async (deleted) => {
    getCallGatewayMock().mockImplementation(async ({ method }) => {
      if (method === 'agent') throw new Error('agent-injected dispatch failure');
      return { ok: true, deleted };
    });
    const result = await spawnSubagentDirect({ task: 'cancelled dispatch', lightContext: true }, { agentSessionKey: parent });
    expect(result.status).toBe('error');
    expect(countActiveRunsForSession(parent)).toBe(deleted ? 0 : 1);
    if (deleted) expect(getSubagentRunByRunId(result.runId!)).toBeNull();
    else expect(getSubagentRunByRunId(result.runId!)?.dispatchPending).toBe(true);
  });

  it('rehydrates unknown dispatch from the actual owner SQLite after memory is cleared', async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), 'autonomy-spawn-state-'));
    vi.stubEnv('OPENCLAW_STATE_DIR', stateDir);
    try {
      // This case keeps production persistence; only transport is fault-injected.
      testing.setDepsForTest({ callGateway: getCallGatewayMock(), getRuntimeConfig: () => ({}),
        ensureContextEnginesInitialized: () => {}, ensureRuntimePluginsLoaded: () => {},
        cleanupBrowserSessionsForLifecycleEnd: async () => {},
        resolveContextEngine: async () => ({
          info: { id: 'test', name: 'Test' },
          assemble: async ({ messages }) => ({ messages, estimatedTokens: 0 }),
          compact: async () => ({ ok: true, compacted: false }),
          ingest: async () => ({ ingested: false }),
        }),
      });
      getCallGatewayMock().mockImplementation(async ({ method }) => {
        if (method === 'agent' || method === 'sessions.delete') throw new Error('agent-injected lost acknowledgement');
        return { ok: true };
      });
      const result = await spawnSubagentDirect({ task: 'durable unknown dispatch', lightContext: true }, { agentSessionKey: parent });
      expect(result.status).toBe('error');
      const onDisk = loadSubagentRegistryFromSqlite();
      expect(onDisk.get(result.runId!)).toMatchObject({ dispatchPending: true, execution: { status: 'pending' } });
      resetSubagentRegistryForTests({ persist: false });
      expect(restoreSubagentRunsFromDisk({ runs: subagentRuns })).toBe(1);
      expect(countActiveRunsForSession(parent)).toBe(1);
      await testing.sweepOnceForTests();
      expect(countActiveRunsForSession(parent)).toBe(1);
      const database = openOpenClawStateDatabase();
      const raw = database.db.prepare('SELECT run_id, ended_at, payload_json FROM subagent_runs').all();
      expect(raw).toHaveLength(1);
      expect(raw[0].ended_at).toBeNull();
      database.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      closeOpenClawStateDatabase();
      const evidenceDir = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission', 'spawn-' + randomUUID());
      mkdirSync(evidenceDir, { recursive: true });
      copyFileSync(database.path, path.join(evidenceDir, 'owner.sqlite'));
      writeFileSync(path.join(evidenceDir, 'owner.json'), JSON.stringify({ driven_by: 'agent',
        actor: 'codex-r1-subagent-owner-test', result, rows: raw, restoredCapacity: 1, retainedStateDir: stateDir,
        limit: 'single gateway owner; transport failure injected; cross-process simultaneous admission not covered',
      }, null, 2) + '\n');
    } finally {
      resetSubagentRegistryForTests({ persist: false });
      closeOpenClawStateDatabase();
      vi.unstubAllEnvs();
      // Retain the small owner database in D: temp as raw acceptance evidence.
    }
  });
});
