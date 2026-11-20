// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { systemProjectOwnerKey } from '../../shared/types/system-portfolio';
import { readSystemProject } from '../../electron/services/system-portfolio';

const owner = vi.hoisted(() => ({ profiles: [] as WorkspaceProfile[], reads: 0 }));
vi.mock('../../electron/services/resource-envelope', () => ({ getAggregatedResourceEnvelopeSnapshot: async () => ({ entries: [
  { id: 'alpha-terminal', workspaceKey: 'alpha', owner: 'main', kind: 'pty-session', activeSlots: 1, queuedCount: 0, updatedAt: Date.now() },
  { id: 'beta-terminal', workspaceKey: 'beta', owner: 'main', kind: 'pty-session', activeSlots: 2, queuedCount: 0, updatedAt: Date.now() },
  { id: 'stale', workspaceKey: 'alpha', owner: 'main', kind: 'pty-session', activeSlots: 10, queuedCount: 0, updatedAt: 1 },
] }) }));
vi.mock('../../electron/services/workspaces-api', () => ({
  getProjectCoordinatorProfiles: async () => { owner.reads++; return structuredClone(owner.profiles); },
}));
vi.mock('../../electron/services/task-system-service', () => ({
  openTaskSystem: async (id: string) => {
    const profile = owner.profiles.find(p => p.id === id)!;
    return new TaskSystemStore(resolveTaskDomain(profile.rootPath));
  },
}));

describe('system portfolio owner read', () => {
  let root: string;
  const digest = createHash('sha256').update('proof').digest('hex');
  const rpc = vi.fn();
  const read = (id: string) => readSystemProject({ workspaceId: id,
    expectedOwnerKey: systemProjectOwnerKey(owner.profiles.find(p => p.id === id)!) }, { rpc });
  function profile(id: string): WorkspaceProfile {
    const key = `agent:main:${id}`, now = new Date().toISOString();
    return { id, name: id, rootPath: root, agentId: 'main', activeSessionKey: key,
      projectCoordinatorSessionKey: key, permissionMode: 'readOnly', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {},
      coordinatorBindings: { [key]: { schemaVersion: 1, workspaceId: id, agentId: 'main', sessionKey: key,
        sessionGeneration: `generation-${id}`, taskLedgerReferences: [], bindingRevision: 1, state: 'active',
        invalidationReason: null, archiveRestorePolicy: 'restore', createdAt: now, updatedAt: now,
        environment: { kind: 'local', canonicalRoot: root, backend: 'local-workspace', branch: null, detachedHead: false, setupProfile: null } } } };
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'system-portfolio-'));
    owner.profiles = [profile('alpha'), profile('beta')]; owner.reads = 0;
    rpc.mockReset().mockImplementation(async (_method, { key }) => ({ session: { key, sessionId: `generation-${key.split(':').at(-1)}` } }));
    writeFileSync(join(root, 'proof.txt'), 'proof');
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      for (const p of owner.profiles) {
        const contract = { objective: `${p.id} objective`, target: 'proof.txt', constraints: [], acceptance: [
          { id: 'proof', description: 'Exact bytes', verification: { kind: 'file-sha256' as const, path: 'proof.txt', sha256: digest } },
        ] };
        store.saveProjectPlan({ workspaceId: p.id, sessionKey: p.activeSessionKey, generation: `generation-${p.id}` }, {
          requestId: `plan-${p.id}`, goal: contract, children: [{ key: 'work', contract }], nextAction: `next-${p.id}`,
        });
      }
    } finally { store.close(); }
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reads two plans from the same task authority without leaking tasks, receipts or changing history', async () => {
    const store = new TaskSystemStore(resolveTaskDomain(root));
    const a = store.projectPlan('alpha')!;
    const claim = store.claim(a.children[0].contract.taskNodeId, 'worker-alpha', 'g', 'claim-alpha').claim!;
    store.verifyFile(claim, 'proof', 'proof.txt', digest, 'candidate-alpha');
    const before = store.list().map(task => store.history(task.contract.taskNodeId));
    const alpha = await read('alpha'), beta = await read('beta');
    expect(alpha).toMatchObject({ workspaceId: 'alpha', coordinator: { state: 'ready', generation: 'generation-alpha' },
      plan: { objective: 'alpha objective', nextAction: 'next-alpha' }, resources: { activeTaskClaims: 1, costUsd: null } });
    expect(alpha.evidence).toHaveLength(1);
    expect(alpha.resources.observations.map(entry => entry.id)).toEqual(['alpha-terminal']);
    expect(beta.resources.observations.map(entry => entry.id)).toEqual(['beta-terminal']);
    expect(alpha.evidence[0]).toMatchObject({ candidate: 'candidate-alpha', sha256: digest });
    expect(beta).toMatchObject({ workspaceId: 'beta', plan: { objective: 'beta objective' }, evidence: [], resources: { activeTaskClaims: 0, costUsd: null } });
    expect(JSON.stringify(beta)).not.toContain('candidate-alpha');
    expect(store.list().map(task => store.history(task.contract.taskNodeId))).toEqual(before);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['sessions.describe', 'sessions.describe']);
    store.close();
  });

  it('rejects missing projects and a request for an old workspace identity', async () => {
    await expect(readSystemProject({ workspaceId: 'missing', expectedOwnerKey: '' }, { rpc })).rejects.toThrow('SYSTEM_PROJECT_UNAVAILABLE');
    await expect(readSystemProject({ workspaceId: 'alpha', expectedOwnerKey: 'old-root' }, { rpc })).rejects.toThrow('SYSTEM_PROJECT_CHANGED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an owner change while the live session read is in flight', async () => {
    rpc.mockImplementationOnce(async () => {
      owner.profiles[0].coordinatorBindings![owner.profiles[0].activeSessionKey].bindingRevision++;
      return { session: { sessionId: 'generation-alpha' } };
    });
    await expect(read('alpha')).rejects.toThrow('SYSTEM_PROJECT_CHANGED');
  });

  it.each(['duplicate', 'archived', 'stale-generation', 'handoff', 'gateway-down'])('keeps %s coordinator unavailable while retaining its task facts', async reason => {
    const p = owner.profiles[0];
    if (reason === 'duplicate') owner.profiles[1].projectCoordinatorSessionKey = p.activeSessionKey;
    if (reason === 'archived') p.archivedSessionKeys = [p.activeSessionKey];
    if (reason === 'stale-generation') rpc.mockResolvedValueOnce({ session: { sessionId: 'new-generation' } });
    if (reason === 'gateway-down') rpc.mockRejectedValueOnce(new Error('disconnected'));
    if (reason === 'handoff') Object.assign(p.coordinatorBindings![p.activeSessionKey], { state: 'paused', invalidationReason: 'handoff-to-new-session' });
    expect(await read('alpha')).toMatchObject({ coordinator: { state: 'unavailable' }, plan: { objective: 'alpha objective' } });
  });
});
