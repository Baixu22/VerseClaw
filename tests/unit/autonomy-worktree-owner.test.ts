// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetWorktreeRegistry, createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';

describe('autonomy worktree owner admission', () => {
  let root: string;
  const owner = { agentId: 'worker', sessionKey: 'agent:worker:one', expectedSessionId: 'generation-one' };
  beforeEach(() => {
    __resetWorktreeRegistry();
    root = mkdtempSync(path.join(tmpdir(), 'autonomy-worktree-'));
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src/a.ts'), 'base');
  });
  afterEach(() => {
    __resetWorktreeRegistry();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['worker', 'same:id', 'same/id'])('never replaces an occupied checkout for %s', (id) => {
    const service = createWorktreeService(root);
    const record = service.create(id, { owner, seedFiles: ['src/a.ts'] });
    writeFileSync(path.join(record.root, 'src/a.ts'), 'unmerged work');
    expect(() => service.create(id, { owner, seedFiles: ['src/a.ts'] })).toThrow(/worktree_already_exists/);
    expect(readFileSync(path.join(record.root, 'src/a.ts'), 'utf8')).toBe('unmerged work');
  });

  it('rejects sanitized id collisions and directories surviving registry loss', () => {
    const service = createWorktreeService(root);
    const record = service.create('same:id', { owner });
    writeFileSync(path.join(record.root, 'keep.txt'), 'retained');
    expect(() => service.create('same/id', { owner })).toThrow(/worktree_already_exists/);
    __resetWorktreeRegistry();
    expect(() => createWorktreeService(root).create('same:id', { owner })).toThrow(/worktree_already_exists/);
    expect(readFileSync(path.join(record.root, 'keep.txt'), 'utf8')).toBe('retained');
  });

  it('returns snapshots whose mutation cannot rewrite owner state', () => {
    const service = createWorktreeService(root);
    const record = service.create('one', { owner, writeSet: ['src/a.ts'] });
    record.status = 'cleaned';
    record.owner!.expectedSessionId = 'forged';
    record.writeSet!.push('secret.txt');
    const listed = service.list()[0];
    expect(listed).toMatchObject({ status: 'active', owner, writeSet: ['src/a.ts'] });
    listed.owner!.expectedSessionId = 'forged-again';
    service.listOwned(owner)[0].status = 'cleaned';
    expect(service.listOwned(owner)).toHaveLength(1);
    expect(service.list()[0].status).toBe('active');
  });

  it.each([0, 60_000])('does not execute under an existing legacy mutex aged %i ms', (age) => {
    const dir = path.join(root, '.openclaw/worktrees');
    mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, '.merge.lock');
    const record = `${process.pid}\n${Date.now() - age}\n`;
    writeFileSync(lock, record);
    expect(() => createWorktreeService(root).create('blocked')).toThrow(/worktree_legacy_lock_unavailable/);
    expect(readFileSync(lock, 'utf8')).toBe(record);
    expect(existsSync(path.join(dir, 'blocked'))).toBe(false);
  });

  it.each(['.', '..'])('rejects %s as a checkout identity without removing the parent', (id) => {
    const service = createWorktreeService(root);
    const retained = service.create('retained');
    writeFileSync(path.join(retained.root, 'keep.txt'), 'keep');
    expect(() => service.create(id)).toThrow(/unsafe_worktree_id/);
    expect(readFileSync(path.join(retained.root, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('records the actual checkout HEAD when the base advances after service creation', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    git('init', '-q');
    git('config', 'user.name', 'Agent');
    git('config', 'user.email', 'agent@example.invalid');
    git('add', 'src/a.ts');
    git('-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), 'commit', '-qm', 'base');
    const service = createWorktreeService(root, { backend: 'git' });
    writeFileSync(path.join(root, 'src/a.ts'), 'new base');
    git('add', 'src/a.ts');
    git('-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), 'commit', '-qm', 'advance');
    const actualHead = git('rev-parse', 'HEAD').trim();
    const record = service.create('git-worker', { owner });
    expect(record.backend).toBe('git');
    expect(record.baseOid).toBe(actualHead);
    expect(readFileSync(path.join(record.root, 'src/a.ts'), 'utf8')).toBe('new base');
    expect(service.inspectIsolation(record.id, record.generation)).toMatchObject({
      status: 'verified', generation: record.generation, headOid: actualHead,
    });
    expect(service.inspectIsolation(record.id, 'stale')).toEqual({ status: 'unverified', reason: 'stale-generation' });
    const second = service.create('second', { owner });
    unlinkSync(path.join(second.root, '.git'));
    writeFileSync(path.join(second.root, '.git'), readFileSync(path.join(record.root, '.git')));
    expect(service.inspectIsolation(second.id, second.generation).status).toBe('unverified');
    service.cleanup(record.id);
    expect(service.inspectIsolation(record.id, record.generation).status).toBe('unverified');
    // A broken repository after owner construction must not become simulation.
    writeFileSync(path.join(root, '.git/HEAD'), 'invalid reference\n');
    expect(() => service.create('failed-git', { owner })).toThrow();
    expect(service.inventory().find(candidate => candidate.id === 'failed-git')?.availability).not.toBe('ready');
  });

  it('never promotes directory simulation or missing owner records to verified isolation', () => {
    const service = createWorktreeService(root);
    const record = service.create('simulation');
    expect(service.inspectIsolation(record.id, record.generation)).toEqual({ status: 'unverified', reason: 'simulated-backend' });
    __resetWorktreeRegistry();
    expect(service.inspectIsolation(record.id, record.generation)).toEqual({ status: 'unverified', reason: 'simulated-backend' });
  });
});
