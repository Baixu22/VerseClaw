// @vitest-environment node
// driven_by: agent; requested_route: ccs-workbuddy/deepseek-v4.1-flash.
// Real Main gate/file locks, session sweep, workspace lifecycle and reclamation aggregation.
// Gateway receipts and process/browser responses are explicit fixtures; no Electron/Runtime launch.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { closeOpenClawAgentDatabasesForTest } from '../../openclaw_runtime/src/state/openclaw-agent-db';
import type { WorkspaceCoordinatorBinding, WorkspaceProfile } from '@shared/types/workspace';
import { createTaskLedgerReference } from '@shared/types/task-ledger-reference';

const fixture = vi.hoisted(() => ({
  root: '', failPort: '', failCoordinatorProgress: false, failGateClear: false,
  ports: [] as Array<{ id: string; sessionKey: string; workspaceId: string; ownership: 'managed' }>,
  stopPort: vi.fn(), closeBrowser: vi.fn(), cascade: vi.fn(),
}));
vi.mock('@electron/utils/paths', async (original) => ({
  ...await original<typeof import('@electron/utils/paths')>(), getOpenClawConfigDir: () => fixture.root,
}));
vi.mock('electron-store', () => ({ default: class {
  name: string;
  constructor(options?: { name?: string; defaults?: Record<string, unknown> }) {
    if (!fixture.root) throw new Error('Lifecycle tail fixture directory is not initialized');
    this.name = options?.name ?? 'config';
    if (!existsSync(join(fixture.root, `${this.name}.json`))) {
      writeFileSync(join(fixture.root, `${this.name}.json`), JSON.stringify(options?.defaults ?? {}));
    }
  }
  get(key: string) { return JSON.parse(readFileSync(join(fixture.root, `${this.name}.json`), 'utf8'))[key]; }
  set(key: string, value: unknown) {
    const file = join(fixture.root, `${this.name}.json`);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data[key] = value; writeFileSync(file, JSON.stringify(data));
  }
} }));
vi.mock('@electron/services/workspace-runtime-sync', () => ({
  syncActiveWorkspacePermissionToRuntime: vi.fn(), syncActiveWorkspaceRootToRuntime: vi.fn(),
}));
vi.mock('@electron/utils/clawx-harness-template', () => ({ ensureVerseClawWorkspaceHarness: vi.fn(async () => ({})) }));
vi.mock('@electron/services/agent-browser-api', () => ({
  getDefaultAgentBrowserService: () => ({ list: () => [], close: fixture.closeBrowser }),
}));
vi.mock('@electron/services/resource-tracker', () => ({
  getResourceTracker: () => ({ list: () => ({ success: true, resources: fixture.ports }), stopResource: fixture.stopPort }),
}));
vi.mock('@electron/services/session-cascade-delete', () => ({ runHostSessionDerivativeCascade: fixture.cascade }));
vi.mock('@electron/services/session-delete-gate', async (original) => {
  const actual = await original<typeof import('@electron/services/session-delete-gate')>();
  return { ...actual, clearSessionDeleteGate: async (id: string) => {
    if (fixture.failGateClear) { fixture.failGateClear = false; throw new Error('injected final gate-clear failure'); }
    return actual.clearSessionDeleteGate(id);
  }, updateSessionDeleteGate: async (...args: Parameters<typeof actual.updateSessionDeleteGate>) => {
    if (fixture.failCoordinatorProgress && args[1].coordinatorCommitted === true) {
      fixture.failCoordinatorProgress = false;
      throw new Error('injected progress-write failure after original coordinator commit');
    }
    return actual.updateSessionDeleteGate(...args);
  } };
});

import { createSessionsApi } from '@electron/services/sessions-api';
import { createWorkspacesApi, getPersistedCoordinatorBinding } from '@electron/services/workspaces-api';
import { findSessionDeleteGateBySession, tryWithSessionDeleteGateLock } from '@electron/services/session-delete-gate';

const key = 'agent:main:tail';
const generation = 'generation-source';
const restoredGeneration = 'generation-restored';
const emptyTerminals = () => ({
  listAll: vi.fn(() => []), countForSession: vi.fn(() => 0),
  reclaimForSession: vi.fn(async () => ({ attempted: 0, reclaimed: 0, kept: 0 })),
});

function profile(id: string, sessionKey: string, binding = true): WorkspaceProfile {
  const coordinator: WorkspaceCoordinatorBinding = {
    schemaVersion: 1, workspaceId: id, agentId: 'main', sessionKey, sessionGeneration: generation,
    state: 'active', bindingRevision: 1, invalidationReason: null, archiveRestorePolicy: 'restore',
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    taskLedgerReferences: [createTaskLedgerReference({ taskLedgerNodeId: 'TF-0661', source: 'runtime' })],
    environment: { kind: 'local', backend: 'local-workspace', canonicalRoot: fixture.root,
      branch: null, detachedHead: false, setupProfile: null },
  };
  return { id, name: id, rootPath: fixture.root, agentId: 'main', activeSessionKey: sessionKey,
    state: {}, sessionStates: { [sessionKey]: {} }, permissionMode: 'acceptEdits',
    createdAt: 1, updatedAt: 1, lastOpenedAt: 1,
    ...(binding ? { coordinatorBindings: { [sessionKey]: coordinator } } : {}),
  };
}
function workspaceDocument(profiles = [profile('workspace-a', key), profile('workspace-b', 'agent:main:other')]) {
  writeFileSync(join(fixture.root, 'workspaces.json'), JSON.stringify({ profiles, activeWorkspaceId: 'workspace-b' }));
}
async function gateOnDisk() {
  const file = JSON.parse(await readFile(join(fixture.root, 'runtime-lifecycle-governance', 'session-delete-gates.json'), 'utf8'));
  return Object.values(file.gates) as Array<Awaited<ReturnType<typeof findSessionDeleteGateBySession>>>;
}

function gatewayFixture(kind: 'archive' | 'restore' | 'delete') {
  const receipts = new Map<string, Record<string, unknown>>();
  let commits = 0;
  const rpc = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    if (method === 'sessions.describe') return { session: { key, sessionId: restoredGeneration } };
    expect(method).toBe(`sessions.${kind}`);
    const id = String(payload.operationId);
    if (!receipts.has(id)) {
      commits++;
      receipts.set(id, { ok: true, key: payload.key, operationId: id, journalState: 'runtime_committed',
        ...(kind === 'restore' ? { restored: true, previousSessionId: generation, entry: { sessionId: restoredGeneration } }
          : { [kind === 'archive' ? 'archived' : 'deleted']: true, sessionId: generation }),
      });
    }
    return receipts.get(id)!;
  });
  return { rpc, receipts, commits: () => commits };
}

beforeEach(async () => {
  fixture.root = await mkdtemp(join(tmpdir(), 'u5-lifecycle-tail-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', fixture.root);
  vi.stubEnv('OPENCLAW_CONTEXT_ARCHIVE_DIR', join(fixture.root, 'context-archive'));
  fixture.failPort = ''; fixture.failCoordinatorProgress = false; fixture.failGateClear = false; fixture.ports = [];
  vi.clearAllMocks();
  fixture.cascade.mockResolvedValue({ success: true, removed: [], errors: [], retryable: false });
  fixture.stopPort.mockImplementation(async (id: string) => {
    if (id === fixture.failPort) return { success: false, error: 'injected owner failure' };
    fixture.ports = fixture.ports.filter(port => port.id !== id);
    return { success: true, resourceId: id };
  });
  workspaceDocument();
  const sessions = join(fixture.root, 'agents', 'main', 'sessions');
  await mkdir(sessions, { recursive: true });
  await writeFile(join(sessions, 'sessions.json'), JSON.stringify({ [key]: { sessionId: generation, sessionFile: `${generation}.jsonl` } }));
  await writeFile(join(sessions, `${generation}.jsonl`), '{"type":"session","id":"generation-source"}\n');
});
afterEach(async () => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  vi.unstubAllEnvs();
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

describe('U5 Main lifecycle tail on the original durable gate', () => {
  it.each(['archive', 'restore'] as const)('%s retains its Runtime generation after one coordinator failure and retries the same ID', async (kind) => {
    const gateway = gatewayFixture(kind);
    const owner = createWorkspacesApi({ gatewayManager: gateway as never,
      gitApi: { status: async () => ({ success: true, status: { isRepository: false, workspaceRoot: fixture.root } }) } as never,
    });
    const coordinator = vi.fn().mockRejectedValueOnce(new Error('injected tail refusal after Runtime receipt'))
      .mockImplementation(owner.coordinatorLifecycle);
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: emptyTerminals() as never });
    const first = await api[kind]({ id: key });
    expect(first).toMatchObject({ success: false, retryable: true, recoveryRequired: true });
    const saved = (await gateOnDisk())[0]!;
    expect(saved).toMatchObject({ operationKind: kind, workspaceId: 'workspace-a', runtimeReceipt: {
      sessionId: kind === 'restore' ? restoredGeneration : generation,
      ...(kind === 'restore' ? { previousSessionId: generation } : {}),
    } });
    const retried = await createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: emptyTerminals() as never })[kind]({ id: key, resumeOperationId: saved.operationId });
    expect(retried).toMatchObject({ success: true, sessionId: saved.runtimeReceipt!.sessionId, operationId: saved.operationId });
    if (kind === 'restore') expect(retried).toMatchObject({ previousSessionId: generation });
    expect(gateway.commits()).toBe(1);
    expect(coordinator).toHaveBeenLastCalledWith({ type: kind, workspaceId: 'workspace-a', sessionKey: key,
      ...(kind === 'restore' ? { previousSessionGeneration: generation, sessionGeneration: restoredGeneration } : {}) });
    expect((await getPersistedCoordinatorBinding('workspace-a', key))?.bindingRevision).toBe(2);
    expect(await gateOnDisk()).toEqual([]);
  });

  it('keeps partial resource evidence and retries only remaining resources after a committed delete', async () => {
    const gateway = gatewayFixture('delete');
    const coordinator = vi.fn(createWorkspacesApi().coordinatorLifecycle);
    const terminalManager = emptyTerminals();
    fixture.ports = ['port-ok', 'port-fail'].map(id => ({ id, sessionKey: key, workspaceId: 'workspace-a', ownership: 'managed' }));
    fixture.failPort = 'port-fail';
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: terminalManager as never });
    expect(await api.delete({ id: key })).toMatchObject({ success: false, resourceReclamation: { recoveryRequired: true } });
    const gate = (await gateOnDisk())[0]!;
    expect(gate).toMatchObject({ localSweepCommitted: true, coordinatorCommitted: true, resourcesCommitted: false, workspaceId: 'workspace-a' });
    expect(gate.resourceReclamationAttempts?.[0]?.owners).toContainEqual(expect.objectContaining({ kind: 'background-port', outcome: 'failed', attempted: 2, reclaimed: 1 }));
    await expect(access(join(fixture.root, 'agents', 'main', 'sessions', `${generation}.jsonl`))).rejects.toMatchObject({ code: 'ENOENT' });
    fixture.failPort = '';
    expect(await api.delete({ id: key, resumeOperationId: gate.operationId })).toMatchObject({ success: true, expectedSessionId: generation });
    expect(gateway.commits()).toBe(1);
    expect(gateway.rpc.mock.calls.map(call => call[1].operationId)).toEqual([gate.operationId, gate.operationId]);
    expect(coordinator).toHaveBeenCalledTimes(1);
    expect(fixture.cascade).toHaveBeenCalledTimes(1);
    expect(fixture.stopPort.mock.calls.filter(([id]) => id === 'port-ok')).toHaveLength(1);
    expect(fixture.stopPort.mock.calls.filter(([id]) => id === 'port-fail')).toHaveLength(2);
    expect(await gateOnDisk()).toEqual([]);
  });

  it('reads back an already applied coordinator state after its gate progress write failed', async () => {
    const gateway = gatewayFixture('archive');
    const coordinator = vi.fn(createWorkspacesApi().coordinatorLifecycle);
    fixture.failCoordinatorProgress = true;
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: emptyTerminals() as never });
    expect((await api.archive({ id: key })).success).toBe(false);
    const gate = (await gateOnDisk())[0]!;
    expect(gate.coordinatorCommitted).not.toBe(true);
    expect((await getPersistedCoordinatorBinding('workspace-a', key))?.bindingRevision).toBe(2);
    expect((await api.archive({ id: key, resumeOperationId: gate.operationId })).success).toBe(true);
    expect(coordinator).toHaveBeenCalledTimes(1);
    expect((await getPersistedCoordinatorBinding('workspace-a', key))?.bindingRevision).toBe(2);
  });

  it('holds the original per-session lock through tail work and rejects a different resume ID', async () => {
    const gateway = gatewayFixture('delete');
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const original = createWorkspacesApi().coordinatorLifecycle;
    const coordinator = vi.fn(async (event: Parameters<typeof original>[0]) => { entered(); await hold; await original(event); });
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: emptyTerminals() as never });
    const first = api.delete({ id: key });
    await started;
    expect(tryWithSessionDeleteGateLock(key, () => 'opened')).toBeUndefined();
    const gate = (await gateOnDisk())[0]!;
    expect(gate.runtimeReceipt?.journalState).toBe('runtime_committed');
    const duplicate = api.delete({ id: key });
    await expect(api.delete({ id: key, resumeOperationId: null } as never)).rejects.toThrow('SESSION_MUTATION_CHANGED');
    const wrong = api.delete({ id: key, resumeOperationId: 'another-operation' });
    const refusal = expect(wrong).rejects.toThrow('SESSION_MUTATION_CHANGED');
    release();
    expect((await first).success).toBe(true);
    expect(await duplicate).toEqual(await first);
    await refusal;
    expect(gateway.commits()).toBe(1);
    expect(gateway.rpc).toHaveBeenCalledTimes(1);
    expect(coordinator).toHaveBeenCalledTimes(1);
  });

  it('skips completed tails after the final gate-clear write fails', async () => {
    const gateway = gatewayFixture('delete');
    const coordinator = vi.fn(createWorkspacesApi().coordinatorLifecycle);
    const terminalManager = emptyTerminals();
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: terminalManager as never });
    fixture.failGateClear = true;
    expect((await api.delete({ id: key })).success).toBe(false);
    const gate = (await gateOnDisk())[0]!;
    expect(gate).toMatchObject({ localSweepCommitted: true, coordinatorCommitted: true, resourcesCommitted: true });
    expect((await api.delete({ id: key, resumeOperationId: gate.operationId })).success).toBe(true);
    expect(gateway.commits()).toBe(1);
    expect(fixture.cascade).toHaveBeenCalledTimes(1);
    expect(coordinator).toHaveBeenCalledTimes(1);
    expect(terminalManager.reclaimForSession).toHaveBeenCalledTimes(1);
    expect(await gateOnDisk()).toEqual([]);
  });

  it('retains unknown owner evidence when the terminal owner is unavailable', async () => {
    const gateway = gatewayFixture('delete');
    const coordinator = vi.fn(createWorkspacesApi().coordinatorLifecycle);
    const first = await createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator }).delete({ id: key });
    expect(first).toMatchObject({ success: false, resourceReclamation: { recoveryRequired: true,
      owners: expect.arrayContaining([expect.objectContaining({ kind: 'terminal', outcome: 'unknown' })]) } });
    const gate = (await gateOnDisk())[0]!;
    expect(gate.resourcesCommitted).toBe(false);
    const recovered = await createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator,
      terminalManager: emptyTerminals() as never }).delete({ id: key, resumeOperationId: gate.operationId });
    expect(recovered.success).toBe(true);
    expect(gateway.commits()).toBe(1);
  });

  it.each(['missing', 'different'] as const)('keeps the gate and foreign resources when workspace scope is %s', async (scope) => {
    if (scope === 'missing') workspaceDocument([profile('workspace-b', 'agent:main:other')]);
    fixture.ports = [{ id: 'foreign', sessionKey: key, workspaceId: 'workspace-b', ownership: 'managed' }];
    const gateway = gatewayFixture('delete');
    const coordinator = vi.fn(createWorkspacesApi().coordinatorLifecycle);
    const terminalManager = emptyTerminals();
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: terminalManager as never });
    expect(await api.delete({ id: key })).toMatchObject({ success: false, error: expect.stringContaining('SCOPE_UNRESOLVED') });
    const gate = (await gateOnDisk())[0]!;
    expect(gate.workspaceId).toBe(scope === 'missing' ? null : 'workspace-a');
    expect(gate.runtimeReceipt?.sessionId).toBe(generation);
    expect(fixture.stopPort).not.toHaveBeenCalled();
    expect(terminalManager.reclaimForSession).not.toHaveBeenCalled();
    expect(fixture.closeBrowser).not.toHaveBeenCalled();
  });

  it('accepts a session with no coordinator binding as a normal no-op', async () => {
    workspaceDocument([profile('workspace-a', key, false)]);
    const gateway = gatewayFixture('archive');
    const coordinator = vi.fn().mockRejectedValue(new Error('must not be called without a binding'));
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: coordinator, terminalManager: emptyTerminals() as never });
    expect((await api.archive({ id: key })).success).toBe(true);
    expect(coordinator).not.toHaveBeenCalled();
    expect(await gateOnDisk()).toEqual([]);
  });

  it('does not reclaim a foreign workspace port registered while terminal cleanup awaits', async () => {
    const gateway = gatewayFixture('delete');
    const terminals = emptyTerminals();
    terminals.reclaimForSession.mockImplementationOnce(async () => {
      fixture.ports.push({ id: 'late-foreign', sessionKey: key, workspaceId: 'workspace-b', ownership: 'managed' });
      return { attempted: 0, reclaimed: 0, kept: 0 };
    });
    const api = createSessionsApi({ gatewayManager: gateway as never, coordinatorLifecycle: createWorkspacesApi().coordinatorLifecycle,
      terminalManager: terminals as never });
    expect((await api.delete({ id: key })).success).toBe(true);
    expect(fixture.stopPort).not.toHaveBeenCalled();
    expect(fixture.ports.map(port => port.id)).toEqual(['late-foreign']);
  });
});
