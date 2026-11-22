// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRuntimeSessionResourceInventory } from '../../openclaw_runtime/src/gateway/session-resource-inventory';
import { sessionAdmissionRegistry } from '../../openclaw_runtime/src/sessions/session-admission-registry';
import { __resetWorktreeRegistry, createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';
import { getProcessSupervisor } from '../../openclaw_runtime/src/process/supervisor/index';
import { resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from '../../openclaw_runtime/src/config/config';

const OWNER = {
  agentId: 'agent-e2',
  sessionKey: 'agent:agent-e2:long-session',
  expectedSessionId: 'generation-e2',
} as const;
const roots: string[] = [];
let stateDbPath: string;

function makeRoot(): string {
  mkdirSync('D:\\tmp', { recursive: true });
  const root = mkdtempSync('D:\\tmp\\clawx-e2-inventory-');
  roots.push(root);
  return root;
}

beforeEach(() => {
  const stateRoot = makeRoot();
  stateDbPath = path.join(stateRoot, 'state', 'openclaw.sqlite');
  vi.stubEnv('OPENCLAW_STATE_DIR', stateRoot);
  vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', stateDbPath);
  setRuntimeConfigSnapshot({});
});

afterEach(() => {
  sessionAdmissionRegistry.clearForTests();
  __resetWorktreeRegistry();
  clearRuntimeConfigSnapshot();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runtime long-session resource inventory', () => {
  it('retains known session owners when the worktree root cannot be read', async () => {
    const missingRoot = path.join(makeRoot(), 'not-created');
    const release = sessionAdmissionRegistry.acquirePermit({
      agentId: OWNER.agentId, canonicalSessionKey: OWNER.sessionKey, expectedSessionId: OWNER.expectedSessionId,
    }, 'exec-spawn');
    try {
      const inventory = await readRuntimeSessionResourceInventory({ ...OWNER, workspaceId: 'workspace-e2', rootPath: missingRoot });
      expect(existsSync(stateDbPath)).toBe(true);
      expect(inventory.scope.expectedSessionId).toBe(OWNER.expectedSessionId);
      expect(inventory.owners.find(owner => owner.kind === 'admission-permit')).toMatchObject({
        generation: OWNER.expectedSessionId, authority: 'managed', state: 'known', activePermits: 1,
      });
      expect(inventory.owners.find(owner => owner.kind === 'process')).toMatchObject({
        generation: OWNER.expectedSessionId, authority: 'managed', state: 'known', count: 0,
      });
      expect(inventory.owners.find(owner => owner.kind === 'worktree')).toMatchObject({
        state: 'unknown', count: null, worktreeIds: null,
      });
    } finally { release(); }
  });
  it('reads admission permits and generation-bound worktrees without inventing measurements', async () => {
    const root = makeRoot();
    const release = sessionAdmissionRegistry.acquirePermit({
      agentId: OWNER.agentId,
      canonicalSessionKey: OWNER.sessionKey,
      expectedSessionId: OWNER.expectedSessionId,
    }, 'exec-spawn');
    const worktrees = createWorktreeService(root);
    worktrees.create('wt-e2', {
      owner: { ...OWNER, retention: 'delete' },
    });

    const before = await readRuntimeSessionResourceInventory({
      sessionKey: OWNER.sessionKey,
      agentId: OWNER.agentId,
      expectedSessionId: OWNER.expectedSessionId,
      workspaceId: 'workspace-e2',
      rootPath: root,
    });
    expect(before.scope.expectedSessionId).toBe(OWNER.expectedSessionId);
    expect(before.owners.find((owner) => owner.kind === 'admission-permit')).toMatchObject({
      state: 'known',
      activePermits: 1,
      waiters: 0,
      authority: 'managed',
    });
    expect(before.owners.find((owner) => owner.kind === 'worktree')).toMatchObject({
      state: 'known',
      count: 1,
      worktreeIds: ['wt-e2'],
      generation: OWNER.expectedSessionId,
    });
    resetResourceEnvelopeLedgerForTest();
    const rebuilt = await readRuntimeSessionResourceInventory({ sessionKey: OWNER.sessionKey, agentId: OWNER.agentId,
      expectedSessionId: OWNER.expectedSessionId, workspaceId: 'workspace-e2', rootPath: root });
    expect(rebuilt.owners.find(owner => owner.kind === 'worktree')).toEqual(before.owners.find(owner => owner.kind === 'worktree'));
    expect(rebuilt.owners.find(owner => owner.kind === 'admission-permit')).toEqual(before.owners.find(owner => owner.kind === 'admission-permit'));
    console.log('[resource-inventory-audit] ' + JSON.stringify({
      schema: before.schema,
      scope: before.scope,
      owners: before.owners,
    }));
    expect(before.owners.find((owner) => owner.kind === 'process')).toMatchObject({
      state: 'known',
      count: 0,
      pids: [],
      helperRefs: 0,
    });

    release();
    const cleanup = worktrees.cleanupOwned(OWNER);
    expect(cleanup).toMatchObject({ attempted: 1, reclaimed: 1, failed: 0, kept: 0 });
    const after = await readRuntimeSessionResourceInventory({
      sessionKey: OWNER.sessionKey,
      agentId: OWNER.agentId,
      expectedSessionId: OWNER.expectedSessionId,
      workspaceId: 'workspace-e2',
      rootPath: root,
    });
    expect(after.owners.find((owner) => owner.kind === 'admission-permit')?.activePermits).toBe(0);
    expect(after.owners.find((owner) => owner.kind === 'worktree')?.count).toBe(0);
  });

  it('keeps missing generation and missing workspace ownership explicit as unknown', async () => {
    const inventory = await readRuntimeSessionResourceInventory({
      sessionKey: OWNER.sessionKey,
      agentId: OWNER.agentId,
      expectedSessionId: null,
      workspaceId: 'workspace-e2',
    });
    expect(inventory.owners).toHaveLength(3);
    expect(inventory.owners.every((owner) => owner.state === 'unknown')).toBe(true);
    expect(inventory.owners.map((owner) => owner.count)).toEqual([null, null, null]);
    expect(inventory.owners.map((owner) => owner.detail).join(' ')).toContain('physical session generation');

    const withGeneration = await readRuntimeSessionResourceInventory({
      sessionKey: OWNER.sessionKey,
      agentId: OWNER.agentId,
      expectedSessionId: OWNER.expectedSessionId,
      workspaceId: 'workspace-e2',
      rootPath: null,
    });
    expect(withGeneration.owners.find((owner) => owner.kind === 'worktree')).toMatchObject({
      state: 'unknown',
      count: null,
      detail: expect.stringContaining('workspace root'),
    });
  });
});
describe('runtime long-session process budget', () => {
  it('rejects a second lifecycle-owned process before spawn when maxProcesses is one', async () => {
    const previous = process.env.OPENCLAW_LONG_SESSION_MAX_PROCESSES;
    process.env.OPENCLAW_LONG_SESSION_MAX_PROCESSES = '1';
    const supervisor = getProcessSupervisor();
    let first: Awaited<ReturnType<typeof supervisor.spawn>> | undefined;
    try {
      first = await supervisor.spawn({
        runId: 'e2-process-one',
        sessionId: OWNER.expectedSessionId,
        backendId: 'e2-budget',
        scopeKey: OWNER.sessionKey,
        lifecycleAgentId: OWNER.agentId,
        lifecycleCanonicalSessionKey: OWNER.sessionKey,
        lifecycleExpectedSessionId: OWNER.expectedSessionId,
        mode: 'child',
        argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        captureOutput: false,
      });
      const resourceRoot = makeRoot();
      const read = () => readRuntimeSessionResourceInventory({ sessionKey: OWNER.sessionKey, agentId: OWNER.agentId,
        expectedSessionId: OWNER.expectedSessionId, rootPath: resourceRoot });
      const before = await read();
      resetResourceEnvelopeLedgerForTest();
      const rebuilt = await read();
      expect(rebuilt.owners.find(owner => owner.kind === 'process')?.pids).toContain(first.pid);
      expect(rebuilt.owners.find(owner => owner.kind === 'process')?.count).toBe(before.owners.find(owner => owner.kind === 'process')?.count);
      const evidence = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission', 'process-owner-' + Date.now());
      mkdirSync(evidence, { recursive: true });
      writeFileSync(path.join(evidence, 'process-owner-rebuild.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-process-owner-reader',
        pid: first.pid, before, rebuilt }, null, 2) + '\n');
      await expect(supervisor.spawn({
        runId: 'e2-process-two',
        sessionId: OWNER.expectedSessionId,
        backendId: 'e2-budget',
        scopeKey: OWNER.sessionKey,
        lifecycleAgentId: OWNER.agentId,
        lifecycleCanonicalSessionKey: OWNER.sessionKey,
        lifecycleExpectedSessionId: OWNER.expectedSessionId,
        mode: 'child',
        argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        captureOutput: false,
      })).rejects.toMatchObject({
        name: 'LongSessionCoordinationError',
        decision: {
          allowed: false,
          reasons: [expect.objectContaining({ dimension: 'maxProcesses', reason: 'limit-exceeded' })],
        },
      });
    } finally {
      if (first) {
        supervisor.cancel(first.runId, 'manual-cancel');
        await first.wait().catch(() => undefined);
      }
      if (previous === undefined) delete process.env.OPENCLAW_LONG_SESSION_MAX_PROCESSES;
      else process.env.OPENCLAW_LONG_SESSION_MAX_PROCESSES = previous;
    }
  }, 60_000);
});
