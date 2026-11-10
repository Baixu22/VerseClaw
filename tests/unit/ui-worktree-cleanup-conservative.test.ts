// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import type { CompleteHostServiceRegistry } from '../../electron/main/ipc/host-contract';
import type { TerminalSessionManager } from '../../electron/services/terminal-session-manager';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { openExecutionTaskStore } from '../../openclaw_runtime/src/agents/execution-task-authority';
import { registerExecutionDomain } from '../../openclaw_runtime/src/agents/execution-domain';
import { createWorktreeService, resolveExecutionCheckout } from '../../openclaw_runtime/src/agents/worktree-service';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { normalizeRunScope } from '../../shared/types/identity-scope';

const state = vi.hoisted(() => ({ profiles: [] as WorkspaceProfile[], grants: [] as Array<{ id: string; requestHash: string }>,
  approved: new Set<string>(), onConsume: null as null | (() => void), failWorkspaceRead: false }));
vi.mock('electron', () => ({ app: { getAppMetrics: () => [] }, shell: {} }));
vi.mock('../../electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: async () => state.profiles[0], getWorkspaceRootPathById: vi.fn(), getPersistedCoordinatorBinding: vi.fn(),
  createWorkspacesApi: () => ({ list: async () => { if (state.failWorkspaceRead) throw new Error('fixture workspace owner unavailable'); return { profiles: state.profiles }; } }),
}));
// 权限/config/resource观测为夹具；Git、Task/registry/writer身份与SQLite均为原实现。
vi.mock('../../electron/services/permissions-api', () => ({
  createPermissionApproval: async (input: { requestHash: string }) => {
    const grant = { ...input, id: `grant-${state.grants.length}` }; state.grants.push(grant); return grant;
  },
  consumeApprovedPermissionApproval: async (input: { id: string; requestHash: string }) => {
    const accepted = state.grants.some(g => g.id === input.id && g.requestHash === input.requestHash && state.approved.has(g.id));
    if (accepted) { state.approved.delete(input.id); state.onConsume?.(); } return accepted;
  }, recordPermissionAudit: async () => undefined,
}));
vi.mock('../../electron/utils/paths', () => ({ getOpenClawConfigDir: () => 'unused-config-path' }));
vi.mock('../../electron/services/agent-browser-api', () => ({ getDefaultAgentBrowserService: () => ({ list: () => [] }) }));
vi.mock('../../electron/services/resource-tracker', () => ({ getResourceTracker: () => ({ list: () => ({ resources: [] }) }) }));

import { createGitApi } from '../../electron/services/git-api';
import { createSessionStorageApi } from '../../electron/services/session-storage-api';
import { inspectUiWorktreeRemoval } from '../../electron/services/task-system-service';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const contract = { objective: 'Retain cleanup evidence', target: 'artifact.txt', constraints: [],
  acceptance: [{ id: 'file', description: 'Exact file', verification: { kind: 'file-sha256' as const, path: 'artifact.txt', sha256: sha('retained\n') } }] };
describe('conservative UI deletion using original Git and owners', () => {
  let root: string, repository: string, tree: string;
  const native = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=NUL', ...args], { cwd, windowsHide: true, encoding: 'utf8', stdio: 'pipe' }).trim();
  const profile = (id: string, path: string): WorkspaceProfile => ({ id, name: id, rootPath: path, agentId: 'main', activeSessionKey: `agent:main:${id}`,
    permissionMode: 'fullAccess', state: {}, createdAt: 1, updatedAt: 1, lastOpenedAt: 1 });
  const storage = () => createSessionStorageApi({
    workspaces: { list: async () => { if (state.failWorkspaceRead) throw new Error('fixture workspace owner unavailable');
      return { success: true, profiles: state.profiles, activeWorkspaceId: state.profiles[0].id }; } } as CompleteHostServiceRegistry['workspaces'],
    terminalManager: { list: () => [] } as unknown as TerminalSessionManager,
  });
  const route = (kind: 'git' | 'storage', approvalId?: string, target = tree) => kind === 'git'
    ? createGitApi().worktreeRemove({ path: target, approvalId }) : storage().removeWorktree({ workspaceId: state.profiles[0].id, path: target, approvalId });
  const blocked = async (kind: 'git' | 'storage', code: string, target = tree) => {
    const response = await route(kind, undefined, target);
    expect(response).toMatchObject({ success: false, blocked: true }); expect(response.reason).toContain(code);
    expect(response.reason).toContain('owner='); expect(response.reason).toContain('/settings/storage');
    expect(response.approvalRequired).not.toBe(true); expect(existsSync(target)).toBe(true);
    const row = (await storage().snapshot()).worktrees.find(row => row.path.replaceAll('\\', '/').toLowerCase() === target.replaceAll('\\', '/').toLowerCase());
    expect(row?.protection).toBeTruthy();
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'u5-ui-conservative-')); repository = join(root, 'repository'); tree = join(root, 'native-tree');
    vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(root, 'execution.sqlite'));
    state.grants.length = 0; state.approved.clear(); state.onConsume = null; state.failWorkspaceRead = false;
    await mkdir(repository); native(repository, 'init', '-b', 'fixture-main'); await writeFile(join(repository, 'artifact.txt'), 'retained\n');
    native(repository, 'add', 'artifact.txt'); native(repository, '-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
    native(repository, 'worktree', 'add', '-b', 'native-fixture', tree); state.profiles = [profile('repository', repository)];
  });
  afterEach(async () => { closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

  for (const kind of ['git', 'storage'] as const) {
    it(`${kind}: removes a taskless native worktree with approval, preserving its branch and no Task DB`, async () => {
      const database = resolveTaskDomain(tree).database, prompt = await route(kind); expect(prompt.approvalRequired).toBe(true);
      expect(existsSync(database)).toBe(false); state.approved.add(prompt.approval!.id);
      expect((await route(kind, prompt.approval!.id)).success).toBe(true); expect(existsSync(tree)).toBe(false);
      expect(native(repository, 'branch', '--list', 'native-fixture')).toContain('native-fixture'); expect(existsSync(database)).toBe(false);
    });
    it(`${kind}: preserves a clean detached unique commit until a shared ref retains it`, async () => {
      native(tree, 'switch', '--detach');
      await writeFile(join(tree, 'unpublished.txt'), 'native detached work\n');
      native(tree, 'add', 'unpublished.txt');
      native(tree, '-c', 'user.name=Agent fixture', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'unpublished detached work');
      const head = native(tree, 'rev-parse', 'HEAD');
      expect(native(tree, 'status', '--porcelain')).toBe('');
      expect(native(repository, 'for-each-ref', `--contains=${head}`, '--format=%(refname)', 'refs/')).toBe('');
      await blocked(kind, 'UI_CLEANUP_COMMIT_RETENTION');
      expect(readFileSync(join(tree, 'unpublished.txt'), 'utf8')).toBe('native detached work\n');
      native(repository, 'branch', 'u5-native-retained', head);
      const prompt = await route(kind);
      expect(prompt.approvalRequired).toBe(true);
      state.approved.add(prompt.approval!.id);
      expect((await route(kind, prompt.approval!.id)).success).toBe(true);
      expect(existsSync(tree)).toBe(false);
      expect(native(repository, 'show', 'refs/heads/u5-native-retained:unpublished.txt')).toBe('native detached work');
    });
    it(`${kind}: routes an empty managed checkout to its original owner`, async () => {
      const record = createWorktreeService(repository, { backend: 'git' }).create('managed', { installStrategy: 'none' });
      await blocked(kind, 'UI_CLEANUP_MANAGED_CHECKOUT', record.root);
    });
    it(`${kind}: refuses even an empty existing Task authority`, async () => {
      const owner = openExecutionTaskStore(tree); owner.close(); await blocked(kind, 'UI_CLEANUP_TASK_AUTHORITY');
    });
    it(`${kind}: protects a moved task checkpoint`, async () => {
      const owner = openExecutionTaskStore(repository);
      try { const task = owner.create(contract, 'task').task, claim = owner.claim(task.contract.taskNodeId, 'agent:main:a', 'g1', 'claim').claim!;
        owner.checkpoint(claim, { completed: [], nextAction: 'retain', unresolved: [], artifacts: [{ path: join(tree, 'artifact.txt'), sha256: sha('retained\n') }] });
      } finally { owner.close(); }
      await blocked(kind, 'UI_CLEANUP_TASK_AUTHORITY');
    });
    it(`${kind}: protects accepted candidate evidence without changing the Task DB`, async () => {
      const owner = openExecutionTaskStore(tree);
      try { const task = owner.create(contract, 'task').task, claim = owner.claim(task.contract.taskNodeId, 'agent:main:a', 'g1', 'claim').claim!;
        owner.verifyFile(claim, 'file', 'artifact.txt', sha('retained\n'), 'candidate'); owner.submit(claim, 'candidate'); owner.accept(claim, 'candidate');
      } finally { owner.close(); }
      const database = resolveTaskDomain(tree).database, before = sha(readFileSync(database));
      await blocked(kind, 'UI_CLEANUP_TASK_AUTHORITY'); expect(sha(readFileSync(database))).toBe(before);
    });
    it(`${kind}: preserves a corrupt Task database for its owner`, async () => {
      const owner = openExecutionTaskStore(tree); owner.close(); writeFileSync(resolveTaskDomain(tree).database, 'not a SQLite database');
      await blocked(kind, 'UI_CLEANUP_TASK_AUTHORITY');
    });
    it(`${kind}: refuses workspace association before permission and after a late approval`, async () => {
      const prompt = await route(kind); expect(prompt.approvalRequired).toBe(true); state.approved.add(prompt.approval!.id);
      state.onConsume = () => state.profiles.push(profile('late', tree));
      expect((await route(kind, prompt.approval!.id)).reason).toContain('UI_CLEANUP_WORKSPACE_REFERENCE');
      await blocked(kind, 'UI_CLEANUP_WORKSPACE_REFERENCE');
    });
    it(`${kind}: rechecks Task ownership when approval completes`, async () => {
      const prompt = await route(kind); state.approved.add(prompt.approval!.id);
      state.onConsume = () => { const owner = openExecutionTaskStore(tree); try { owner.create(contract, 'late'); } finally { owner.close(); } };
      const response = await route(kind, prompt.approval!.id); expect(response.reason).toContain('UI_CLEANUP_TASK_AUTHORITY'); expect(existsSync(tree)).toBe(true);
    });
    it(`${kind}: never infers no references from a Workspace owner read failure`, async () => {
      state.failWorkspaceRead = true; const response = await route(kind);
      expect(response).toMatchObject({ success: false, blocked: true }); expect(response.reason).toContain('UI_CLEANUP_OWNER_UNAVAILABLE');
      expect(response.reason).toContain('/settings/storage'); expect(existsSync(tree)).toBe(true);
    });
  }
  it('distinguishes independent clones until explicit registration with the existing authority', () => {
    const clone = join(root, 'clone'), child = join(root, 'clone-tree'); native(root, 'clone', repository, clone); native(clone, 'worktree', 'add', '-b', 'clone-child', child);
    const owner = openExecutionTaskStore(repository); owner.create(contract, 'task'); owner.close();
    expect(inspectUiWorktreeRemoval(clone, child, [profile('clone', clone)]).blocked).toBe(false);
    expect(inspectUiWorktreeRemoval(repository, child, state.profiles)).toMatchObject({ blocked: true, reason: expect.stringContaining('UI_CLEANUP_FOREIGN_GIT_DOMAIN') });
    registerExecutionDomain({ workspaceRoot: clone, authorityRoot: repository, actor: 'fixture', operationId: 'register', expectedRevision: 0, projectRevision: 1 });
    expect(inspectUiWorktreeRemoval(clone, child, [profile('clone', clone)])).toMatchObject({ blocked: true, reason: expect.stringContaining('UI_CLEANUP_TASK_AUTHORITY') });
  });
  it('refuses active and released original checkout writer records', async () => {
    const checkout = resolveExecutionCheckout(tree), token = checkout.service.claimWriter(null, checkout.basis.generation,
      { kind: 'run', agentId: 'main', sessionGeneration: 'g1', bindingRevision: 1, run: normalizeRunScope({ runId: 'a', scope: { workspaceId: 'fixture', sessionKey: 'agent:main:a' } }) }, 'claim');
    await blocked('git', 'UI_CLEANUP_CHECKOUT_OWNER'); checkout.service.releaseWriter(token);
    await blocked('storage', 'UI_CLEANUP_CHECKOUT_OWNER');
  });
  it('binds approval to native identity across path reuse', async () => {
    const prompt = await route('git'); state.approved.add(prompt.approval!.id);
    native(repository, 'worktree', 'remove', '--', tree); native(repository, 'worktree', 'add', tree, 'native-fixture');
    const response = await route('git', prompt.approval!.id); expect(response.approvalRequired).toBe(true); expect(existsSync(tree)).toBe(true);
  });
  it('retains native Git dirty rejection and creates no maintenance reservation', async () => {
    await writeFile(join(tree, 'unsaved.txt'), 'keep'); const prompt = await route('git'); state.approved.add(prompt.approval!.id);
    expect((await route('git', prompt.approval!.id)).success).toBe(false); expect(readFileSync(join(tree, 'unsaved.txt'), 'utf8')).toBe('keep');
    expect(resolveExecutionCheckout(tree).service.writer(null)).toBeNull();
  });
  it('keeps enabled VG cleanup authority on its original path', async () => {
    vi.stubEnv('CLAWX_VERSGIT_BINDING_ENABLED', '1'); await blocked('git', 'UI_CLEANUP_VG_OWNER');
  });
});
