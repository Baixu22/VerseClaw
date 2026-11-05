// @vitest-environment node
import { mkdir, mkdtemp, readFile, writeFile, rm, utimes, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskLedgerEventInput, TaskLedgerOperationIdentity } from '@shared/types/task-ledger';
import type { TaskLedgerAgentActionPayload } from '@shared/host-api/contract';

vi.mock('@electron/utils/paths', () => ({ getOpenClawConfigDir: () => state.root }));
const state = vi.hoisted(() => ({ root: '', failSnapshot: false, sharingFailure: 0, birthProbeFailures: 0, beforeJournalRead: undefined as (() => Promise<void>) | undefined }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
    if (process.platform === 'win32' && state.birthProbeFailures > 0 && /(?:^|[\\/])(?:pwsh|powershell)\.exe$/iu.test(String(args[0]))) {
      state.birthProbeFailures--; throw Object.assign(new Error('Simulated first OS birth probe startup timeout'), { code: 'ETIMEDOUT' });
    }
    return actual.execFileSync(...args);
  } };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: (...args: Parameters<typeof actual.renameSync>) => {
    if (process.platform === 'win32' && state.sharingFailure > 0 && String(args[0]).endsWith('.stage')) {
      state.sharingFailure--; throw Object.assign(new Error('Simulated Windows delete-sharing violation'), { code: 'EPERM' });
    }
    return actual.renameSync(...args);
  } };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: async (...args: Parameters<typeof actual.readFile>) => {
    if (state.beforeJournalRead && String(args[0]).endsWith('events.jsonl')) {
      const hook = state.beforeJournalRead; state.beforeJournalRead = undefined; await hook();
    }
    return actual.readFile(...args);
  }, writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
    if (state.failSnapshot && String(args[0]).endsWith('snapshot.json')) { state.failSnapshot = false; throw new Error('A2 simulated projection write failure after journal append'); }
    return actual.writeFile(...args);
  } };
});
vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: async () => ({ id: 'workspace-owner', activeSessionKey: 'agent:main:owned' }),
}));
import {
  appendTaskLedgerEvents, commitTaskLedgerOperation, getTaskLedgerEventsPath,
  getTaskLedgerSnapshotPath, loadTaskLedgerSnapshot, readTaskLedgerEvents,
} from '@electron/services/task-ledger-service';
import { createTaskLedgerApi } from '@electron/services/task-ledger-api';
import { taskLedgerLockPath as lockPathFor, taskLedgerSessionEpochPath, withTaskLedgerJournalLock as withFileLock } from '../../shared/task-ledger-journal-lock';
import { runExclusiveSessionStoreWrite } from '../../openclaw_runtime/src/config/sessions/store-writer';

const identity = {
  actor: 'assistant', agentId: 'main', runtimeGeneration: 'gateway-1',
  runtimeOwner: { childPid: 42, connectedAt: 1 },
  scope: { workspaceId: 'workspace-owner', projectId: 'workspace-owner', sessionKey: 'agent:main:owned', sessionGeneration: 'session-generation-1' },
} as TaskLedgerOperationIdentity;
const event = (id: string): TaskLedgerEventInput => ({
  id, type: 'node_created', actor: 'assistant',
  payload: { node: { id: `node-${id}`, title: id, kind: 'task', status: 'todo', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z' } },
});
const commit = (operationId: string, expectedRevision = 0, events = [event(operationId)], request: unknown = { title: 'same legitimate intent' }) =>
  commitTaskLedgerOperation({ workspaceId: 'workspace-owner', operationId, expectedRevision, request, identity, events });

function runWorker(value: Parameters<typeof commitTaskLedgerOperation>[0], extra: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve('openclaw_runtime/node_modules/tsx/dist/cli.mjs'), '--tsconfig',
      resolve('openclaw_runtime/tsconfig.json'), resolve('tests/fixtures/autonomy-task-action-worker.mts'), JSON.stringify(value)], {
      cwd: process.cwd(), windowsHide: true, env: { ...process.env, OPENCLAW_CONFIG_DIR: state.root,
        OPENCLAW_STATE_DIR: join(state.root, 'isolated-runtime-state'), ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject); child.on('close', code => done({ code, stdout, stderr }));
  });
}

async function retainEvidence(name: string, data: unknown): Promise<void> {
  const dir = process.env.CLAWX_A2_EVIDENCE_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), JSON.stringify({
    driven_by: 'agent', actor: 'codex-a2-vitest', candidate: process.env.CLAWX_A2_CANDIDATE ?? null,
    recordedAt: new Date().toISOString(), data,
  }, null, 2));
}

beforeEach(async () => { state.failSnapshot = false; state.sharingFailure = 0; state.beforeJournalRead = undefined; state.root = await mkdtemp(join(tmpdir(), 'clawx-a2-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(state.root, { recursive: true, force: true }); });

describe('TF-0671 existing Task Ledger log transaction', () => {
  it('retains its own ticket through a transient Windows delete-sharing publication failure', async () => {
    state.sharingFailure = process.platform === 'win32' ? 2 : 0;
    state.birthProbeFailures = process.platform === 'win32' ? 1 : 0;
    let entries = 0;
    await withFileLock(join(state.root, 'sharing-lock'), async () => { entries++; });
    expect(entries).toBe(1); expect(state.sharingFailure).toBe(0); expect(state.birthProbeFailures).toBe(0);
    expect((await readdir(lockPathFor(join(state.root, 'sharing-lock')))).filter(name => name.endsWith('.json') || name.endsWith('.stage'))).toEqual([]);
  });
  it('keeps accepted manual Date metadata when checksumming its persisted JSON representation', async () => {
    const created = await createTaskLedgerApi().createNode({ workspaceId: 'workspace-owner', node: {
      title: 'Manual structured metadata', metadata: { observedAt: new Date('2026-11-03T00:00:00Z'), nested: [{ when: new Date('2026-11-03T00:00:01Z') }] },
    } });
    expect(created.snapshot.nodes).toHaveLength(1);
    expect(created.snapshot.warnings).toEqual([]);
    expect(created.snapshot.nodes[0].metadata).toEqual({ observedAt: '2026-11-03T00:00:00.000Z', nested: [{ when: '2026-11-03T00:00:01.000Z' }] });
    expect((await readTaskLedgerEvents('workspace-owner')).events[0].actor).toBe('user');
  });
  it('commits a multi-event operation once and replays the same receipt after projection damage', async () => {
    const first = await commit('batch-1', 0, [event('one'), event('two')]);
    expect(first.receipt).toMatchObject({ operationId: 'batch-1', revision: 2, replayed: false, identity });
    expect(first.snapshot.nodes.map(node => node.id)).toEqual(['node-one', 'node-two']);
    await writeFile(getTaskLedgerSnapshotPath('workspace-owner'), '{broken projection');
    const replay = await commit('batch-1', 0, [event('one'), event('two')]);
    expect(replay.receipt).toMatchObject({ ...first.receipt, replayed: true });
    expect(replay.snapshot.eventsCount).toBe(2);
    expect((await readTaskLedgerEvents('workspace-owner')).events).toHaveLength(2);
    expect(JSON.parse(await readFile(getTaskLedgerSnapshotPath('workspace-owner'), 'utf8')).nodes).toHaveLength(2);
    await retainEvidence('batch-replay', { first: first.receipt, replay: replay.receipt,
      journal: await readFile(getTaskLedgerEventsPath('workspace-owner'), 'utf8'), snapshot: replay.snapshot });
  });

  it('allows exactly one of two stale revision writers and recovers concurrent duplicates', async () => {
    const writers = await Promise.allSettled([commit('a'), commit('b')]);
    expect(writers.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    const failed = writers.find(row => row.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason.code).toBe('VALIDATION');
    const first = writers.find(row => row.status === 'fulfilled');
    if (first?.status !== 'fulfilled') throw new Error('No committed operation');
    const id = first.value.receipt.operationId;
    const duplicates = await Promise.all([commit(id), commit(id)]);
    expect(duplicates.every(row => row.receipt.replayed)).toBe(true);
    expect((await loadTaskLedgerSnapshot('workspace-owner')).eventsCount).toBe(1);
    await retainEvidence('concurrent-replay', { writers: writers.map(row => row.status === 'fulfilled'
      ? { status: row.status, receipt: row.value.receipt }
      : { status: row.status, code: row.reason.code, message: row.reason.message }),
    duplicates: duplicates.map(row => row.receipt), events: (await readTaskLedgerEvents('workspace-owner')).events });
  });

  it('rejects same-key different payload while allowing a new same-parameter intent', async () => {
    await commit('intent-one');
    await expect(commit('intent-one', 0, [event('intent-one')], { title: 'different' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const second = await commit('intent-two', 1);
    expect(second.snapshot.nodes).toHaveLength(2);
    expect(second.receipt.replayed).toBe(false);
  });

  it('replays a durable append after the first projection write failed', async () => {
    state.failSnapshot = true;
    await expect(commit('after-append')).rejects.toThrow('projection write failure');
    expect((await readTaskLedgerEvents('workspace-owner')).events).toHaveLength(1);
    const replay = await commit('after-append');
    expect(replay.receipt.replayed).toBe(true);
    expect(replay.snapshot.nodes).toHaveLength(1);
  });

  it('does not project an incomplete log frame or treat it as a committed batch', async () => {
    const log = getTaskLedgerEventsPath('workspace-owner');
    await mkdir(join(log, '..'), { recursive: true });
    await writeFile(log, '{"schema":"TaskLedgerCommit/v1","operation":{"operationId":"torn"},"events":[');
    const result = await commit('torn', 0, [event('complete-one'), event('complete-two')]);
    expect(result.snapshot.nodes).toHaveLength(2);
    expect(result.snapshot.eventsCount).toBe(2);
    const replay = await commit('torn', 0, [event('complete-one'), event('complete-two')]);
    expect(replay.receipt.replayed).toBe(true);
    expect(replay.snapshot.nodes).toHaveLength(2);
    await retainEvidence('torn-frame-recovery', { receipt: replay.receipt, snapshot: replay.snapshot,
      journal: await readFile(log, 'utf8') });
  });

  it('serializes new automatic and existing manual writes through the same log owner', async () => {
    const manual = { ...event('manual'), actor: 'user' as const };
    await Promise.allSettled([appendTaskLedgerEvents('workspace-owner', [manual]), commit('automatic')]);
    const log = await readTaskLedgerEvents('workspace-owner');
    expect(log.events.some(row => row.actor === 'user')).toBe(true);
    expect(new Set(log.events.map(row => row.id)).size).toBe(log.events.length);
    expect(log.warnings).toEqual([]);
  });

  it('keeps every event in an existing shared-key batch and rejects a complete damaged frame atomically', async () => {
    const batch = [event('batch-first'), event('batch-second')].map(row => ({ ...row, actor: 'system' as const }));
    await appendTaskLedgerEvents('workspace-owner', batch, 'existing-batch');
    const journal = getTaskLedgerEventsPath('workspace-owner');
    const raw = await readFile(journal, 'utf8');
    const frame = JSON.parse(raw);
    frame.events[1].payload.node.title = 'damaged bytes';
    await writeFile(journal, JSON.stringify(frame) + '\n');
    const damaged = await loadTaskLedgerSnapshot('workspace-owner');
    expect(damaged.eventsCount).toBe(0);
    expect(damaged.nodes).toEqual([]);
    expect(damaged.warnings).toHaveLength(1);
    const repaired = await appendTaskLedgerEvents('workspace-owner', batch, 'existing-batch');
    expect(repaired.eventsCount).toBe(2);
    expect(repaired.nodes.map(node => node.id)).toEqual(['node-batch-first', 'node-batch-second']);
    expect((await appendTaskLedgerEvents('workspace-owner', batch, 'existing-batch')).eventsCount).toBe(2);
    expect((await readTaskLedgerEvents('workspace-owner')).events.map(row => row.actor)).toEqual(['system', 'system']);
    await retainEvidence('damaged-frame-recovery', { damaged, repaired,
      journal: await readFile(journal, 'utf8') });
  });

  it('fences competing processes and recovers an actual subprocess exit after durable append', async () => {
    const input = (operationId: string) => ({ workspaceId: 'workspace-owner', operationId, expectedRevision: 0,
      request: { title: 'same legitimate intent' }, identity, events: [event(operationId)] });
    const worker = (value: ReturnType<typeof input>, mode: 'normal' | 'projection-failure' | 'abrupt-exit' | 'runtime' | 'lock-before' | 'lock-after' = 'normal') => runWorker(value, {
      A2_EXIT_LOCK_PUBLISH: mode === 'lock-before' ? 'before' : mode === 'lock-after' ? 'after' : '',
      A2_RUNTIME_WRITE: mode === 'runtime' ? '1' : '0', A2_EXPECT_PROJECTION_FAILURE: mode === 'projection-failure' ? '1' : '0',
      A2_EXIT_DURING_PROJECTION: mode === 'abrupt-exit' ? '1' : '0',
    });
    const competing = await Promise.all([worker(input('process-one')), worker(input('process-two'))]);
    expect(competing.map(row => row.code).sort(), JSON.stringify(competing)).toEqual([0, 2]);
    expect((await readTaskLedgerEvents('workspace-owner')).events).toHaveLength(1);

    const isolated = 'crash-workspace';
    const crashInput = { ...input('after-process-exit'), workspaceId: isolated, identity: { ...identity, scope: { ...identity.scope, workspaceId: isolated } } } as ReturnType<typeof input>;
    const projectionPath = getTaskLedgerSnapshotPath(isolated);
    await mkdir(projectionPath, { recursive: true });
    const stopped = await worker(crashInput, 'projection-failure');
    expect(stopped.code, stopped.stdout + stopped.stderr).toBe(73);
    expect(JSON.parse(stopped.stdout)).toMatchObject({ durableEventsBeforeExit: 1, projectionFailureAfterAppend: true });
    await rm(projectionPath, { recursive: true });
    const replay = await worker(crashInput);
    expect(replay.code, replay.stdout + replay.stderr).toBe(0);
    expect(JSON.parse(replay.stdout).receipt.replayed).toBe(true);
    expect((await loadTaskLedgerSnapshot(isolated)).eventsCount).toBe(1);

    const abruptInput = { ...crashInput, workspaceId: 'abrupt-workspace', identity: { ...identity, scope: { ...identity.scope, workspaceId: 'abrupt-workspace' } } } as ReturnType<typeof input>;
    const abrupt = await worker(abruptInput, 'abrupt-exit');
    expect(abrupt.code, abrupt.stdout + abrupt.stderr).toBe(73);
    expect(JSON.parse(abrupt.stdout)).toEqual({ abruptExitAfterAppend: true });
    const orphan = lockPathFor(getTaskLedgerEventsPath(abruptInput.workspaceId));
    const orphanRecords = (await readdir(orphan)).filter(name => name.endsWith('.json'));
    expect(orphanRecords).toHaveLength(1);
    expect(JSON.parse(await readFile(join(orphan, orphanRecords[0]), 'utf8')).pid).toBeGreaterThan(0);
    const recovered = await Promise.all([worker(abruptInput), worker(abruptInput)]);
    expect(recovered.map(row => row.code), JSON.stringify(recovered)).toEqual([0, 0]);
    expect(recovered.every(row => JSON.parse(row.stdout).receipt.replayed)).toBe(true);
    expect((await loadTaskLedgerSnapshot(abruptInput.workspaceId)).eventsCount).toBe(1);
    await retainEvidence('crash-recovery', {
      competing, projectionFailureExit: stopped, projectionReplay: replay,
      abruptExit: abrupt, abruptRecovered: recovered,
      recovery: 'unique per-acquisition participant record; dead process probe, no lease expiry',
      journal: await readFile(getTaskLedgerEventsPath(abruptInput.workspaceId), 'utf8'),
      snapshot: await loadTaskLedgerSnapshot(abruptInput.workspaceId),
      limits: ['controlled process.exit inside projection after journal fsync; not power-loss or arbitrary disk corruption proof'],
    });
    const interrupted = [];
    for (const mode of ['lock-before', 'lock-after'] as const) {
      const publicationInput = { ...crashInput, workspaceId: mode, identity: { ...identity, scope: { ...identity.scope, workspaceId: mode } } } as ReturnType<typeof input>;
      const exited = await worker(publicationInput, mode);
      expect(exited.code, exited.stdout + exited.stderr).toBe(mode === 'lock-before' ? 74 : 75);
      const resumes = await Promise.all([worker(publicationInput), worker(publicationInput)]);
      expect(resumes.map(row => row.code), JSON.stringify(resumes)).toEqual([0, 0]);
      expect((await loadTaskLedgerSnapshot(mode)).eventsCount).toBe(1);
      interrupted.push({ mode, exited, resumes });
    }
    await retainEvidence('interrupted-lock-publication', interrupted);

    const runtimeWorkspace = 'runtime-shared-workspace';
    const runtimeInput = { ...input('runtime-shared'), workspaceId: runtimeWorkspace,
      identity: { ...identity, scope: { ...identity.scope, workspaceId: runtimeWorkspace } },
      events: [{ ...event('runtime-shared'), actor: 'system', idempotencyKey: 'main-runtime-shared-key' }],
    } as ReturnType<typeof input>;
    await appendTaskLedgerEvents(runtimeWorkspace, runtimeInput.events);
    const runtimeReplay = await worker(runtimeInput, 'runtime');
    expect(runtimeReplay.code, runtimeReplay.stdout + runtimeReplay.stderr).toBe(0);
    expect(JSON.parse(runtimeReplay.stdout).revision.eventCount).toBe(1);
    expect((await loadTaskLedgerSnapshot(runtimeWorkspace)).eventsCount).toBe(1);
    const runtimeNew = { ...runtimeInput, events: [{ ...event('runtime-new'), actor: 'system', idempotencyKey: 'runtime-new-key' }] } as ReturnType<typeof input>;
    const mainNew = { ...runtimeInput, operationId: 'main-competing', expectedRevision: 1, events: [event('main-competing')] };
    const crossOwner = await Promise.all([worker(runtimeNew, 'runtime'), worker(mainNew)]);
    expect(crossOwner[0].code, JSON.stringify(crossOwner)).toBe(0);
    expect([0, 2]).toContain(crossOwner[1].code);
    const crossLog = await readTaskLedgerEvents(runtimeWorkspace);
    expect(crossLog.events.filter(row => row.id === 'runtime-new')).toHaveLength(1);
    expect(crossLog.events).toHaveLength(crossOwner[1].code === 0 ? 3 : 2);
    expect(crossLog.warnings).toEqual([]);
    await retainEvidence('runtime-main-interop', { runtimeReplay, crossOwner, events: crossLog.events,
      journal: await readFile(getTaskLedgerEventsPath(runtimeWorkspace), 'utf8') });
  }, 60000);

  it('does not expire a live journal writer and fails closed on a corrupt participant', async () => {
    const path = getTaskLedgerEventsPath('workspace-owner');
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const holder = withFileLock(path, async () => { acquired(); await held; });
    try {
      await ready;
      const old = new Date(Date.now() - 31_000);
      const ownerFile = (await readdir(lockPathFor(path))).find(name => name.endsWith('.json'));
      if (!ownerFile) throw new Error('Active owner record missing');
      await utimes(join(lockPathFor(path), ownerFile), old, old);
      await expect(withFileLock(path, async () => 'stolen', { timeoutMs: 100, pollMs: 5 })).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
    } finally { release(); await holder; }
    await writeFile(join(lockPathFor(path), `${process.pid}-${randomUUID()}.json`), '{unknown ownership');
    await expect(withFileLock(path, async () => 'stolen', { timeoutMs: 100, pollMs: 5 })).rejects.toMatchObject({ code: 'LOCK_CORRUPT' });
  });

  it('reclaims an orphan from an earlier incarnation even when its PID is the current live PID', async () => {
    const path = getTaskLedgerEventsPath('workspace-owner');
    const token = randomUUID();
    await mkdir(lockPathFor(path), { recursive: true });
    const orphan = join(lockPathFor(path), `${process.pid}-${token}.json`);
    await writeFile(orphan, JSON.stringify({ pid: process.pid, token, choosing: true, ticket: 0,
      incarnation: 'retired-process-incarnation', publishedAt: Date.now() - 2000 }));
    const result = await withFileLock(path, async () => 'admitted');
    expect(result).toBe('admitted');
    expect((await readdir(lockPathFor(path))).filter(name => name.endsWith('.json'))).toEqual([]);
    await retainEvidence('reused-pid-orphan', { pid: process.pid, oldIncarnation: 'retired-process-incarnation',
      admitted: result, limitation: 'orphan record simulates OS PID reuse; current process birth identity is read from the actual OS' });
  });

  it('preserves exclusion under four competing processes and one hundred guarded writes', async () => {
    const input = { workspaceId: 'workspace-owner', operationId: 'lock-stress', expectedRevision: 0, request: {}, identity, events: [event('stress')] };
    const results = await Promise.all(Array.from({ length: 4 }, () => runWorker(input, { A2_LOCK_STRESS: '1' })));
    expect(results.map(row => row.code), JSON.stringify(results)).toEqual([0, 0, 0, 0]);
    const count = Number(await readFile(getTaskLedgerEventsPath(input.workspaceId) + '.test-counter', 'utf8'));
    expect(count).toBe(100);
    await retainEvidence('cross-process-lock-exclusion', { results, count, guard: 'exclusive wx file inside every critical section' });
  }, 30000);
});

function runtimeOwner(changeSecondGeneration = false) {
  let reads = 0;
  const rpc = vi.fn(async (method: string) => {
    if (method === 'runtime.flags.ack') return { gatewayGeneration: 'gateway-1', childPid: 42 };
    reads++;
    const generation = changeSecondGeneration && reads > 1 ? 'replacement-session-generation' : 'session-generation-1';
    return { snapshot: { session: { sessionId: generation, storePath: join(state.root, 'sessions.json') }, policy: { scope: {
      workspaceId: 'workspace-owner', sessionKey: 'agent:main:owned', agentId: 'main', sessionId: generation,
    } } } };
  });
  return { rpc, getStatus: () => ({ state: 'running', pid: 42, connectedAt: 1 }) };
}
const actionInput = (operationId: string, expectedRevision = 0): TaskLedgerAgentActionPayload => ({
  operationId, expectedRevision, scope: identity.scope, runtimeGeneration: 'gateway-1',
  runtimeOwner: identity.runtimeOwner,
  action: { type: 'create', node: { title: 'Automatic agent task' } },
});

describe('TF-0671 typed controlled automatic task action', () => {
  it('requires an owner-backed claim for new automatic business done while manual and turn check done retain their meaning', async () => {
    const api = createTaskLedgerApi({ gatewayManager: runtimeOwner() as never });
    const request = actionInput('automatic-task');
    await expect(api.applyAgentAction({ ...request, action: { type: 'create', node: { title: 'Model says done', status: 'done' } } })).rejects.toMatchObject({ code: 'VALIDATION' });
    const created = await api.applyAgentAction(request);
    const node = created.snapshot.nodes[0];
    expect(node.metadata?.automaticCompletion).toMatchObject({ authority: 'task-ledger', state: 'pending', scope: request.scope });
    await expect(api.applyAgentAction({ ...actionInput('self-complete', 1), action: { type: 'update', taskNodeId: node.id, patch: { status: 'done' } } })).rejects.toThrow('owner-backed completion claim');
    const check = await api.applyAgentAction({ ...actionInput('turn-check', 1), action: { type: 'create', node: { title: 'Turn check recorded', kind: 'check', status: 'done' } } });
    expect(check.snapshot.nodes.find(item => item.kind === 'check')?.status).toBe('done');
    const manual = await api.updateNode({ workspaceId: 'workspace-owner', nodeId: node.id, patch: { status: 'done' } });
    expect(manual.snapshot.nodes.find(item => item.id === node.id)?.status).toBe('done');
    expect((await readTaskLedgerEvents('workspace-owner')).events.at(-1)?.actor).toBe('user');
  });
  it('fences a same-key session reset attempted after the final owner read until the journal commits', async () => {
    const storePath = join(state.root, 'sessions.json');
    let generation = 'session-generation-1', acks = 0, resetStarted = false, resetDone = false;
    let reset: Promise<void> | undefined;
    const gateway = { getStatus: () => ({ state: 'running', pid: 42, connectedAt: 1 }), rpc: async (method: string) => {
      if (method === 'runtime.flags.ack') {
        if (++acks === 2) state.beforeJournalRead = async () => {
          resetStarted = true;
          reset = runExclusiveSessionStoreWrite(storePath, async () => { generation = 'replacement'; resetDone = true; });
          await new Promise(resolve => setTimeout(resolve, 20));
          expect(resetDone).toBe(false);
        };
        return { gatewayGeneration: 'gateway-1', childPid: 42 };
      }
      return { snapshot: { session: { sessionId: generation, storePath }, policy: { scope: {
        workspaceId: 'workspace-owner', sessionKey: 'agent:main:owned', agentId: 'main', sessionId: generation,
      } } } };
    } };
    const api = createTaskLedgerApi({ gatewayManager: gateway as never });
    const committed = await api.applyAgentAction(actionInput('reset-linearization'));
    await reset;
    expect(resetStarted).toBe(true); expect(resetDone).toBe(true);
    expect(committed.receipt.identity.scope.sessionGeneration).toBe('session-generation-1');
    await expect(api.applyAgentAction(actionInput('after-completed-reset', 1))).rejects.toThrow();
    await expect(api.applyAgentAction(actionInput('invalid-retired-generation', 1))).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await loadTaskLedgerSnapshot('workspace-owner')).eventsCount).toBe(1);
    await retainEvidence('session-reset-fence', { committed: committed.receipt, resetStarted, resetDone, retiredGenerationRejected: true,
      fenceResource: taskLedgerSessionEpochPath(storePath), order: 'existing session store writer epoch fence -> Task Ledger journal ticket' });
  });
  it('refreshes the runtime session epoch after journal contention before admitting a new write', async () => {
    let changed = false, acks = 0;
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    let holder: Promise<void> | undefined;
    const original = runtimeOwner();
    const gateway = { getStatus: original.getStatus, rpc: async (method: string) => {
      if (method === 'runtime.flags.ack' && ++acks === 2) {
        holder = withFileLock(getTaskLedgerEventsPath('workspace-owner'), async () => { acquired(); await held; });
        await ready;
        setTimeout(() => { changed = true; release(); }, 25);
      }
      if (changed && method === 'session.activitySnapshot') return { snapshot: { session: { sessionId: 'replacement', storePath: join(state.root, 'sessions.json') }, policy: { scope: {
        workspaceId: 'workspace-owner', sessionKey: 'agent:main:owned', agentId: 'main', sessionId: 'replacement',
      } } } };
      return original.rpc(method);
    } };
    try {
      await expect(createTaskLedgerApi({ gatewayManager: gateway as never }).applyAgentAction(actionInput('queued-old-epoch'))).rejects.toThrow();
    } finally { release(); await holder; }
    expect(changed).toBe(true);
    expect((await readTaskLedgerEvents('workspace-owner')).events).toEqual([]);
  });
  it('allows Gateway RPC handling to acquire the journal before automatic admission takes its ticket', async () => {
    const owner = runtimeOwner();
    let acks = 0;
    const gateway = { getStatus: owner.getStatus, rpc: async (method: string) => {
      if (method === 'runtime.flags.ack' && ++acks === 2) {
        const result = await runWorker({ workspaceId: 'workspace-owner', operationId: 'rpc-lock-probe', expectedRevision: 0,
          request: {}, identity, events: [event('rpc-lock-probe')] }, { A2_LOCK_ONLY: '1' });
        expect(result.code, result.stdout + result.stderr).toBe(0);
      }
      return owner.rpc(method);
    } };
    const result = await createTaskLedgerApi({ gatewayManager: gateway as never }).applyAgentAction(actionInput('no-rpc-lock-cycle'));
    expect(result.snapshot.eventsCount).toBe(1);
    expect(acks).toBe(3);
  });
  it('recovers a committed receipt after Gateway replacement or unavailability without readmitting its old epoch', async () => {
    const input = actionInput('persisted-before-restart');
    const first = await createTaskLedgerApi({ gatewayManager: runtimeOwner() as never }).applyAgentAction(input);
    const replacement = { getStatus: () => ({ state: 'running', pid: 99, connectedAt: 2 }),
      rpc: vi.fn(async () => { throw new Error('Recovery must not consult Gateway'); }) };
    const api = createTaskLedgerApi({ gatewayManager: replacement as never });
    const replay = await api.applyAgentAction(input);
    expect(replay.receipt).toEqual({ ...first.receipt, replayed: true });
    expect(replacement.rpc).not.toHaveBeenCalled();
    expect((await createTaskLedgerApi().applyAgentAction(input)).receipt.replayed).toBe(true);
    await expect(api.applyAgentAction({ ...input, action: { type: 'create', node: { title: 'different intent' } } })).rejects.toThrow('different request');
    await expect(api.applyAgentAction({ ...input, operationId: 'uncommitted-before-restart' })).rejects.toThrow();
    expect((await loadTaskLedgerSnapshot('workspace-owner')).eventsCount).toBe(1);
    await retainEvidence('hosted-restart-replay', { first: first.receipt, replay: replay.receipt, eventsCount: replay.snapshot.eventsCount });
  });

  it('does not let automatic operation IDs suppress existing lifecycle batch keys', async () => {
    const api = createTaskLedgerApi({ gatewayManager: runtimeOwner() as never });
    await api.applyAgentAction(actionInput('mission:owner-mission'));
    await appendTaskLedgerEvents('workspace-owner', [{ ...event('real-mission-lifecycle'), actor: 'system' }], 'mission:owner-mission');
    const read = await readTaskLedgerEvents('workspace-owner');
    expect(read.events.map(row => row.actor)).toEqual(['assistant', 'system']);
    expect(read.events[0].idempotencyKey).toBeNull();
    expect(read.events[1].idempotencyKey).toBe('mission:owner-mission');
    await retainEvidence('legacy-key-isolation', read);
  });
  it('rejects requests from a prior Gateway process even when the app generation counter repeats', async () => {
    const previousRequest = actionInput('before-app-restart');
    const old = runtimeOwner();
    const replacement = { getStatus: () => ({ state: 'running', pid: 99, connectedAt: 2 }),
      rpc: async (method: string) => method === 'runtime.flags.ack'
        ? { gatewayGeneration: 'gateway-1', childPid: 99 } : old.rpc(method) };
    const api = createTaskLedgerApi({ gatewayManager: replacement as never });
    await expect(api.applyAgentAction(previousRequest)).rejects.toThrow();
    await expect(api.applyAgentAction({ ...previousRequest, runtimeOwner: { childPid: 42, connectedAt: 2 } })).rejects.toThrow();
    const current = await api.applyAgentAction({ ...previousRequest, runtimeOwner: { childPid: 99, connectedAt: 2 } });
    expect(current.receipt.identity.runtimeOwner).toEqual({ childPid: 99, connectedAt: 2 });
    expect(current.snapshot.eventsCount).toBe(1);
  });
  it('derives assistant identity from existing owners for create, link and update; manual edits stay user', async () => {
    const api = createTaskLedgerApi({ gatewayManager: runtimeOwner() as never });
    const created = await api.applyAgentAction(actionInput('create-operation'));
    const taskNodeId = created.snapshot.nodes[0].id;
    expect(created.receipt.identity).toEqual(identity);
    await api.applyAgentAction({ ...actionInput('link-operation', 1), action: { type: 'link', taskNodeId } });
    const updated = await api.applyAgentAction({ ...actionInput('update-operation', 2), action: { type: 'update', taskNodeId, patch: { title: 'Updated by agent', status: 'doing' } } });
    expect(updated.snapshot.sessionLinks).toMatchObject([{ nodeId: taskNodeId, sessionKey: identity.scope.sessionKey, agentId: 'main' }]);
    expect(updated.snapshot.nodes[0]).toMatchObject({ title: 'Updated by agent', owner: 'agent' });
    await api.updateNode({ workspaceId: 'workspace-owner', nodeId: taskNodeId, patch: { description: 'manual owner action' } });
    expect((await readTaskLedgerEvents('workspace-owner')).events.map(event => event.actor)).toEqual(['assistant', 'assistant', 'assistant', 'user']);
    expect((await api.applyAgentAction(actionInput('create-operation'))).receipt.replayed).toBe(true);
  });

  it.each(['done', 'dropped'] as const)('denies a new automatic update of a manually %s task until explicit reopen', async status => {
    const api = createTaskLedgerApi({ gatewayManager: runtimeOwner() as never });
    const created = await api.applyAgentAction(actionInput('terminal-created'));
    const taskNodeId = created.snapshot.nodes[0].id;
    const manual = await api.updateNode({ workspaceId: 'workspace-owner', nodeId: taskNodeId, patch: { status } });
    const update: TaskLedgerAgentActionPayload = { ...actionInput('terminal-update', manual.snapshot.eventsCount),
      action: { type: 'update', taskNodeId, patch: { status: 'doing', title: 'Automatic reopen' } } };
    await expect(api.applyAgentAction(update)).rejects.toThrow('explicit manual reopen');
    const unchanged = await loadTaskLedgerSnapshot('workspace-owner');
    expect(unchanged.eventsCount).toBe(manual.snapshot.eventsCount);
    expect(unchanged.nodes).toEqual(manual.snapshot.nodes);
    expect((await api.applyAgentAction(actionInput('terminal-created'))).receipt.replayed).toBe(true);
    const reopened = await api.updateNode({ workspaceId: 'workspace-owner', nodeId: taskNodeId, patch: { status: 'doing' } });
    const accepted = await api.applyAgentAction({ ...update, operationId: 'after-explicit-reopen', expectedRevision: reopened.snapshot.eventsCount });
    expect(accepted.snapshot.nodes[0]).toMatchObject({ status: 'doing', title: 'Automatic reopen' });
  });

  it('replays an earlier link after its task was deleted without repeating its effect', async () => {
    const api = createTaskLedgerApi({ gatewayManager: runtimeOwner() as never });
    const created = await api.applyAgentAction(actionInput('create-operation'));
    const taskNodeId = created.snapshot.nodes[0].id;
    const payload: TaskLedgerAgentActionPayload = { ...actionInput('link-operation', 1), action: { type: 'link', taskNodeId } };
    const linked = await api.applyAgentAction(payload);
    await appendTaskLedgerEvents('workspace-owner', [{ type: 'node_deleted', actor: 'user', taskId: taskNodeId, payload: { nodeId: taskNodeId } }]);
    const replay = await api.applyAgentAction(payload);
    expect(replay.receipt).toEqual({ ...linked.receipt, replayed: true });
    expect(replay.snapshot.eventsCount).toBe(3);
    expect(replay.snapshot.nodes).toEqual([]);
    await expect(api.applyAgentAction({ ...payload, operationId: 'new-link', expectedRevision: 3 })).rejects.toThrow('Task node does not exist');
    expect((await readTaskLedgerEvents('workspace-owner')).events).toHaveLength(3);
  });

  it.each(['actor', 'principal', 'identity'])('rejects model-provided %s before reading an owner or writing the log', async field => {
    const gateway = runtimeOwner();
    const api = createTaskLedgerApi({ gatewayManager: gateway as never });
    await expect(api.applyAgentAction({ ...actionInput('forged'), [field]: 'system' } as TaskLedgerAgentActionPayload)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(gateway.rpc).not.toHaveBeenCalled();
    expect((await readTaskLedgerEvents('workspace-owner')).events).toEqual([]);
  });

  it.each(['workspaceId', 'sessionKey', 'sessionGeneration', 'projectId'] as const)('rejects mismatched %s scope', async field => {
    const api = createTaskLedgerApi({ gatewayManager: runtimeOwner() as never });
    const payload = actionInput('wrong-scope');
    await expect(api.applyAgentAction({ ...payload, scope: { ...payload.scope, [field]: 'other-owner' } } as TaskLedgerAgentActionPayload)).rejects.toThrow();
    expect((await readTaskLedgerEvents('workspace-owner')).events).toEqual([]);
  });

  it('rejects a stale Gateway stamp and a session replaced while waiting for the journal owner', async () => {
    const gateway = runtimeOwner();
    const api = createTaskLedgerApi({ gatewayManager: gateway as never });
    await expect(api.applyAgentAction({ ...actionInput('stale-gateway'), runtimeGeneration: 'old-gateway' })).rejects.toThrow();
    const replaced = createTaskLedgerApi({ gatewayManager: runtimeOwner(true) as never });
    await expect(replaced.applyAgentAction(actionInput('replaced'))).rejects.toThrow();
    expect((await readTaskLedgerEvents('workspace-owner')).events).toEqual([]);
  });
});
