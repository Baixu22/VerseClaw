// @vitest-environment node
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureAgentWorkspace } from '../../openclaw_runtime/src/agents/workspace';
import { openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { closeOpenClawAgentDatabasesForTest } from '../../openclaw_runtime/src/state/openclaw-agent-db';

describe('workspace bootstrap preserves established task ownership', () => {
  let fixture: string;
  let workspace: string;
  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'task-bootstrap-'));
    workspace = join(fixture, 'workspace');
    mkdirSync(workspace);
    vi.stubEnv('OPENCLAW_STATE_DIR', join(fixture, 'state'));
  });
  afterEach(() => {
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();
    vi.unstubAllEnvs();
    rmSync(fixture, { recursive: true, force: true });
  });
  it('keeps the local domain and restores the same task after first-run bootstrap', async () => {
    const store = openExecutionTaskStore(workspace);
    try {
      const original = store.start({ contract: { objective: 'Continue the same task', target: '.', constraints: [],
        acceptance: [{ id: 'receipt', description: 'Owner evidence', verification: { kind: 'owner-receipt', owner: 'agent-fixture' } }] } },
      'agent:main:writer', 'before', 'start');
      const domain = resolveTaskDomain(workspace);
      await ensureAgentWorkspace({ dir: workspace, ensureBootstrapFiles: true });
      expect(existsSync(join(workspace, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(workspace, '.git'))).toBe(false);
      expect(resolveTaskDomain(workspace)).toEqual(domain);
      const restored = store.restoreSessionScope('agent:main:writer', 'before', 'after');
      expect(restored?.contract.taskNodeId).toBe(original.contract.taskNodeId);
      expect(restored?.claim).toMatchObject({ generation: 'after', epoch: original.claim!.epoch + 1 });
      expect(() => store.binding('agent:main:writer', 'before')).toThrow('TASK_GENERATION_STALE');
      expect(() => store.assertOwner(original.claim!)).toThrow('TASK_STALE_OWNER');
    } finally { store.close(); }
  });
  it('still initializes Git for a new workspace with no task authority', async () => {
    await ensureAgentWorkspace({ dir: workspace, ensureBootstrapFiles: true });
    expect(existsSync(join(workspace, '.git'))).toBe(true);
    expect(existsSync(join(workspace, 'AGENTS.md'))).toBe(true);
  });
});
