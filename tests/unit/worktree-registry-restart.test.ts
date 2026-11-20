// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';
import * as registry from '../../openclaw_runtime/src/agents/worktree-registry';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

describe('durable managed checkout registration', () => {
  let fixture: string;
  let root: string;
  const owner = { agentId: 'worker', sessionKey: 'agent:worker:persistent', expectedSessionId: 'generation-1' };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'registry-'));
    root = path.join(fixture, 'repo'); mkdirSync(root);
    vi.stubEnv('OPENCLAW_STATE_DIR', path.join(fixture, 'state'));
  });
  afterEach(() => {
    vi.restoreAllMocks(); closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs();
    rmSync(fixture, { recursive: true, force: true });
  });
  function initGit() {
    git('init', '-q'); writeFileSync(path.join(root, 'tracked.txt'), 'base'); git('add', '.');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  }
  it('recovers owner, generation and queue in a fresh process after abrupt exit', () => {
    initGit();
    const require = createRequire(path.resolve('openclaw_runtime/package.json'));
    const loader = require.resolve('tsx/cli');
    const script = path.resolve('tests/fixtures/worktree-registry-process.ts');
    const config = path.resolve('openclaw_runtime/tsconfig.json');
    const first = spawnSync(process.execPath, [loader, '--tsconfig', config, script, root, 'create'], { encoding: 'utf8', windowsHide: true, env: process.env });
    expect(first.status, first.stderr).toBe(23);
    const created = JSON.parse(first.stdout);
    const second = spawnSync(process.execPath, [loader, '--tsconfig', config, script, root, 'read'], { encoding: 'utf8', windowsHide: true, env: process.env });
    expect(second.status, second.stderr).toBe(0);
    const observed = JSON.parse(second.stdout);
    expect(observed.records).toHaveLength(1);
    expect(observed.records[0]).toMatchObject({ generation: created.generation, owner });
    expect(observed.inventory[0].availability).toBe('ready');
    expect(observed.queue).toHaveLength(1);
  });
  it.each(['intent', 'allocated', 'created', 'registered', 'ready'] as const)('persists the %s crash boundary without claiming incomplete setup is ready', phase => {
    const original = registry.saveWorktreeRegistryScope;
    const fault = vi.spyOn(registry, 'saveWorktreeRegistryScope').mockImplementation(scope => {
      original(scope);
      if (scope.records.get('crash')?.registration.phase === phase) throw new Error('injected crash after durable step');
    });
    const service = createWorktreeService(root);
    expect(() => service.create('crash', { operationId: 'crash-op', owner })).toThrow('injected crash');
    fault.mockRestore(); closeOpenClawStateDatabaseForTest();
    const restarted = createWorktreeService(root);
    const row = restarted.inventory().find(item => item.id === 'crash')!;
    expect(row.record?.registration.phase).toBe(phase);
    expect(row.availability).toBe(phase === 'intent' ? 'missing' : phase === 'ready' ? 'ready' : 'incomplete');
    if (phase === 'registered' || phase === 'ready') {
      expect(restarted.create('crash', { operationId: 'crash-op', owner }).generation).toBe(row.record!.generation);
    } else {
      expect(() => restarted.create('crash', { operationId: 'crash-op', owner })).toThrow(/worktree_(missing|incomplete)/);
    }
  });
  it('rejects an old incarnation after the same path is replaced and preserves the replacement', () => {
    const service = createWorktreeService(root);
    const record = service.create('replace', { owner });
    renameSync(record.root, `${record.root}-old`); mkdirSync(record.root);
    writeFileSync(path.join(record.root, 'user.txt'), 'keep');
    closeOpenClawStateDatabaseForTest();
    expect(service.inventory().find(row => row.id === 'replace')?.availability).toBe('replaced');
    expect(() => service.cleanup('replace')).toThrow(/worktree_replaced/);
    expect(readFileSync(path.join(record.root, 'user.txt'), 'utf8')).toBe('keep');
  });
  it('canonicalizes path aliases and keeps unowned directories visible', () => {
    const alias = path.join(fixture, 'alias'); symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const record = createWorktreeService(root).create('one', { owner });
    mkdirSync(path.join(root, '.openclaw/worktrees/external'));
    const service = createWorktreeService(alias);
    expect(service.listOwned(owner)[0].generation).toBe(record.generation);
    expect(service.inventory().find(row => row.id === 'external')?.availability).toBe('unowned');
  });
  it('retains missing records and gives recreated managed checkouts a new generation', () => {
    const service = createWorktreeService(root);
    const old = service.create('one');
    service.cleanup('one');
    const next = service.create('one');
    expect(next.generation).not.toBe(old.generation);
    rmSync(next.root, { recursive: true });
    expect(service.inventory().find(row => row.id === 'one')?.availability).toBe('missing');
  });
  it('rejects same operation with different input and blocks merge replay after unknown copy outcome', () => {
    const service = createWorktreeService(root);
    const one = service.create('one', { operationId: 'stable' });
    expect(() => service.create('one', { operationId: 'stable', writeSet: ['different'] })).toThrow(/operation_conflict/);
    writeFileSync(path.join(one.root, 'a.txt'), 'a');
    service.enqueueMerge({ worktreeId: 'one', changedFiles: ['a.txt'] });
    const original = registry.saveWorktreeRegistryScope;
    const fault = vi.spyOn(registry, 'saveWorktreeRegistryScope').mockImplementation(scope => {
      original(scope);
      if (scope.queue.some(item => item.reason === 'merge_outcome_unknown')) throw new Error('copy interrupted');
    });
    expect(() => service.processMergeQueue()).toThrow('copy interrupted');
    fault.mockRestore(); closeOpenClawStateDatabaseForTest();
    expect(service.processMergeQueue()[0]).toMatchObject({ status: 'conflict', reason: 'merge_outcome_unknown' });
    expect(() => service.enqueueMerge({ worktreeId: 'one', changedFiles: ['a.txt'] })).toThrow(/reconciliation_required/);
    expect(() => service.cleanup('one')).toThrow(/reconciliation_required/);
  });
  it('resumes a recorded cleanup without reopening execution or adopting a replacement', () => {
    const service = createWorktreeService(root);
    service.create('one');
    const original = registry.saveWorktreeRegistryScope;
    const fault = vi.spyOn(registry, 'saveWorktreeRegistryScope').mockImplementation(scope => {
      original(scope);
      if (scope.records.get('one')?.status === 'cleaning') throw new Error('cleanup interrupted');
    });
    expect(() => service.cleanup('one')).toThrow('cleanup interrupted');
    fault.mockRestore(); closeOpenClawStateDatabaseForTest();
    expect(service.inventory()[0].availability).toBe('incomplete');
    service.cleanup('one');
    expect(service.list()[0].status).toBe('cleaned');
  });
  it('rejects a changed Git binding before promoting registered to ready', () => {
    initGit();
    const service = createWorktreeService(root, { backend: 'git' });
    const original = registry.saveWorktreeRegistryScope;
    const fault = vi.spyOn(registry, 'saveWorktreeRegistryScope').mockImplementation(scope => {
      original(scope);
      if (scope.records.get('pending')?.registration.phase === 'registered') throw new Error('registered interruption');
    });
    expect(() => service.create('pending', { operationId: 'pending-op' })).toThrow('registered interruption');
    fault.mockRestore();
    const other = service.create('other');
    unlinkSync(path.join(service.pathFor('pending'), '.git'));
    writeFileSync(path.join(service.pathFor('pending'), '.git'), readFileSync(path.join(other.root, '.git')));
    closeOpenClawStateDatabaseForTest();
    expect(() => service.create('pending', { operationId: 'pending-op' })).toThrow(/worktree_(unknown|replaced)/);
    expect(service.list().find(row => row.id === 'pending')!.registration.phase).toBe('registered');
  });
});
