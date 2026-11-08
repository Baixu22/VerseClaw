import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';
import { registerExecutionDomain, resolveExecutionDomain } from '../../openclaw_runtime/src/agents/execution-domain';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

describe('explicit local task authority routing', () => {
  let root: string;
  let a: string;
  let b: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'execution-domain-'));
    a = path.join(root, 'a'); b = path.join(root, 'b'); mkdirSync(a); mkdirSync(b);
    vi.stubEnv('OPENCLAW_STATE_DIR', path.join(root, 'state'));
    const store = new TaskSystemStore(resolveTaskDomain(a)); store.close();
  });
  afterEach(() => {
    closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true });
  });
  const registration = () => ({ workspaceRoot: b, authorityRoot: a, actor: 'runtime-owner', operationId: 'enroll', expectedRevision: 0, projectRevision: 1 });
  it('keeps independent roots separate, then returns the registered authority without copying task data', () => {
    expect(resolveExecutionDomain(b)).toMatchObject({ state: 'independent', authority: { id: resolveTaskDomain(b).id } });
    const service = createWorktreeService(b);
    const { workspaceRoot: _root, ...input } = registration();
    const record = service.registerTaskAuthority(input);
    closeOpenClawStateDatabaseForTest();
    expect(service.taskAuthority(1)).toMatchObject({ state: 'registered', authority: {
      id: resolveTaskDomain(a).id, database: resolveTaskDomain(a).database, worktree: resolveTaskDomain(b).worktree,
    }, registration: { revision: record.revision, actor: 'runtime-owner' } });
  });
  it('makes identical registration retries idempotent and rejects conflicts or stale revisions', () => {
    const first = registerExecutionDomain(registration());
    expect(registerExecutionDomain(registration())).toEqual(first);
    expect(() => registerExecutionDomain({ ...registration(), actor: 'different' })).toThrow(/operation_conflict/);
    expect(() => registerExecutionDomain({ ...registration(), operationId: 'next' })).toThrow(/revision_conflict/);
    expect(resolveExecutionDomain(b, 2)).toMatchObject({ state: 'unavailable', reason: 'execution_project_revision_stale' });
  });
  it('does not fall back to a local database after the registered authority disappears or is copied', () => {
    registerExecutionDomain(registration());
    const db = resolveTaskDomain(a).database;
    renameSync(db, `${db}.original`);
    expect(resolveExecutionDomain(b).state).toBe('unavailable');
    copyFileSync(`${db}.original`, db);
    expect(resolveExecutionDomain(b)).toMatchObject({ state: 'unavailable', reason: 'execution_task_authority_replaced' });
  });
  it('rejects uninitialized authorities and registration chains', () => {
    expect(() => registerExecutionDomain({ ...registration(), workspaceRoot: a, authorityRoot: b })).toThrow(/authority_missing/);
    registerExecutionDomain(registration());
    const third = path.join(root, 'c'); mkdirSync(third);
    const bStore = new TaskSystemStore(resolveTaskDomain(b)); bStore.close();
    expect(() => registerExecutionDomain({ ...registration(), workspaceRoot: third, authorityRoot: b })).toThrow(/authority_indirect/);
    const cStore = new TaskSystemStore(resolveTaskDomain(third)); cStore.close();
    expect(() => registerExecutionDomain({ ...registration(), workspaceRoot: a, authorityRoot: third })).toThrow(/has_dependents/);
  });
  it('shares common-dir identity across actual Git worktrees without explicit enrollment', () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', a, ...args], { encoding: 'utf8', windowsHide: true });
    git('init', '-q'); writeFileSync(path.join(a, 'a.txt'), 'a'); git('add', 'a.txt');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
    const tree = path.join(root, 'linked'); git('worktree', 'add', '--detach', tree, 'HEAD');
    const result = resolveExecutionDomain(tree);
    expect(result).toMatchObject({ state: 'independent', authority: { id: resolveTaskDomain(a).id } });
    expect(() => registerExecutionDomain({ ...registration(), workspaceRoot: tree, authorityRoot: a })).toThrow(/already_local/);
  });
});
