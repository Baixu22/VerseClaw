// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectRuntimeConfig } from '../../openclaw_runtime/src/agents/project-runtime-policy';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { isSystemExecutionControl } from '../../shared/system-execution-control';
import { applyWorkspaceSandboxConfig } from '../../shared/workspace-runtime-permissions';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types';

const session = vi.hoisted(() => ({ current: { sessionId: 'g', workspaceId: 'alpha' } as { sessionId: string; workspaceId?: string } }));
vi.mock('../../openclaw_runtime/src/config/sessions/store', () => ({ getSessionEntry: () => session.current }));

describe('project runtime policy', () => {
  let root: string, path: string;
  const writeOwner = (permissionMode: string) => writeFileSync(path, JSON.stringify({ activeWorkspaceId: 'beta', profiles: [
    { id: 'alpha', rootPath: root, permissionMode, activeSessionKey: 'coordinator' },
    { id: 'beta', rootPath: 'D:/other', permissionMode: 'readOnly', activeSessionKey: 'other' },
  ] }));
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'project-policy-')); path = join(root, 'workspaces.json');
    session.current = { sessionId: 'g', workspaceId: 'alpha' }; writeOwner('fullAccess');
    vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', path);
  });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
  it('replaces active-project defaults for the bound project and keeps explicit tool denies', () => {
    const config: OpenClawConfig = { tools: { deny: ['browser'] } };
    applyWorkspaceSandboxConfig(config as Record<string, unknown>, 'readOnly');
    const before = JSON.stringify(config);
    const effective = resolveProjectRuntimeConfig(config, 'coordinator', 'g', root)!;
    expect(effective.tools?.exec).toMatchObject({ security: 'full', ask: 'off' });
    expect(effective.agents?.defaults?.sandbox?.workspaceAccess).toBe('none');
    expect(effective.tools?.deny).toEqual(['browser']);
    expect(JSON.stringify(config)).toBe(before);
    writeOwner('plan');
    expect(resolveProjectRuntimeConfig(config, 'coordinator', 'g', root)?.tools?.exec).toMatchObject({ security: 'deny', ask: 'always' });
  });
  it('accepts a worker only through its persistent task binding and rejects stale or unrelated identities', () => {
    const store = new TaskSystemStore(resolveTaskDomain(root));
    try {
      store.start({ contract: { objective: 'Worker task', target: '.', constraints: [], acceptance: [
        { id: 'v', description: 'Verify task', verification: { kind: 'owner-receipt', owner: 'fixture' } },
      ] } }, 'worker', 'g', 'start');
      expect(resolveProjectRuntimeConfig({}, 'worker', 'g', root)?.tools?.exec?.security).toBe('full');
      expect(() => resolveProjectRuntimeConfig({}, 'unknown-worker', 'g', root)).toThrow('TASK_PROJECT_POLICY_SCOPE_MISMATCH');
      expect(() => resolveProjectRuntimeConfig({}, 'worker', 'old-g', root)).toThrow('TASK_GENERATION_STALE');
    } finally { store.close(); }
  });
  it('preserves config for sessions without project association', () => {
    session.current = { sessionId: 'g' }; const config = { tools: { deny: ['write'] } };
    expect(resolveProjectRuntimeConfig(config, 'ordinary', 'g', root)).toBe(config);
  });
  it.each([['task_loop', 'status'], ['mission_loop', 'status'], ['transcripts', 'stop'], ['process', 'kill'], ['subagents', 'kill']])('keeps %s %s in the control channel', (tool, action) => {
    expect(isSystemExecutionControl(tool, { action })).toBe(true);
    expect(isSystemExecutionControl(tool, { action: 'run' })).toBe(false);
  });
});
