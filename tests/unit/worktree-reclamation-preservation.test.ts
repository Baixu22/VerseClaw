// @vitest-environment node
import { execFileSync } from 'node:child_process';
import * as childProcess from 'node:child_process';
import * as snapshot from '../../openclaw_runtime/src/agents/worktree-merge-files';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertWorktreeIndexVisible, createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';
import * as writers from '../../openclaw_runtime/src/agents/worktree-writer';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';

vi.mock('node:child_process', async importOriginal => { const actual = await importOriginal<typeof import('node:child_process')>(); return { ...actual }; });

describe('R4 independent reclamation preservation', () => {
  let fixture: string, root: string;
  beforeEach(() => { fixture = mkdtempSync(path.join(tmpdir(), 'r4-reclaim-')); root = path.join(fixture, 'repo'); mkdirSync(root);
    vi.stubEnv('OPENCLAW_STATE_DIR', path.join(fixture, 'state')); });
  afterEach(() => { vi.restoreAllMocks(); closeOpenClawStateDatabaseForTest(); vi.unstubAllEnvs(); rmSync(fixture, { recursive: true, force: true }); });
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { windowsHide: true, encoding: 'utf8' }).trim();
  function repository() { git('init', '-q'); writeFileSync(path.join(root, '.gitignore'), '.openclaw/\n.env\n');
    writeFileSync(path.join(root, 'a.txt'), 'base'); git('add', '.');
    git('-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); }
  function proof(name: string, data: unknown) {
    const out = process.env.R4_RECLAMATION_PROOF_DIR; if (!out) return; mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, name + '.json'), JSON.stringify({ driven_by: 'agent', actor: 'r4-independent-reclamation-test', data }, null, 2));
  }
  it('retains an undeclared inprocess file observed on disk', () => {
    const service = createWorktreeService(root), row = service.create('worker'); writeFileSync(path.join(row.root, 'outside.txt'), 'owned bytes');
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_user_content_present');
    expect(readFileSync(path.join(row.root, 'outside.txt'), 'utf8')).toBe('owned bytes');
  });
  it('retains declared inprocess bytes until an exact copy exists in the retained target', () => {
    writeFileSync(path.join(root, 'a.txt'), 'base'); const service = createWorktreeService(root);
    const row = service.create('worker', { seedFiles: ['a.txt'], writeSet: ['a.txt'] }); writeFileSync(path.join(row.root, 'a.txt'), 'worker bytes');
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_unretained_content');
    expect(readFileSync(path.join(row.root, 'a.txt'), 'utf8')).toBe('worker bytes');
    writeFileSync(path.join(root, 'a.txt'), 'worker bytes'); service.cleanup(row.id); expect(existsSync(row.root)).toBe(false);
    proof('retained-copy', { copy: readFileSync(path.join(root, 'a.txt'), 'utf8'), removed: !existsSync(row.root) });
  });
  it('retains permission-only inprocess changes', () => {
    writeFileSync(path.join(root, 'a.txt'), 'base'); const service = createWorktreeService(root);
    const row = service.create('worker', { seedFiles: ['a.txt'], writeSet: ['a.txt'] }); chmodSync(path.join(row.root, 'a.txt'), 0o444);
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_unretained_mode');
    expect(readFileSync(path.join(row.root, 'a.txt'), 'utf8')).toBe('base');
  });
  it('retains ignored Git content even when its path was declared', () => {
    repository(); const service = createWorktreeService(root, { backend: 'git' }); const row = service.create('worker', { writeSet: ['.env'] });
    writeFileSync(path.join(row.root, '.env'), 'local value'); expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_ignored_content_present');
    expect(readFileSync(path.join(row.root, '.env'), 'utf8')).toBe('local value');
  });
  it('rechecks ignored content after admission and settles a known refusal as not-applied', () => {
    repository(); const service = createWorktreeService(root, { backend: 'git' }); const row = service.create('worker');
    const original = writers.withCheckoutMaintenance;
    vi.spyOn(writers, 'withCheckoutMaintenance').mockImplementation((bases, operation, effect, prepare, outcome) => original(bases, operation,
      () => { writeFileSync(path.join(row.root, '.env'), 'late bytes'); return effect(); }, prepare, outcome));
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_ignored_content_present');
    expect(service.writer(row.id)).toMatchObject({ state: 'released', operations: [{ state: 'settled', receipt: { outcome: 'not-applied' } }] });
    expect(service.list()[0].status).toBe('active'); expect(readFileSync(path.join(row.root, '.env'), 'utf8')).toBe('late bytes');
    proof('known-refusal', { writer: service.writer(row.id), record: service.list()[0] });
  });
  it('preserves a path replacement introduced after admission', () => {
    const service = createWorktreeService(root), row = service.create('worker'); const saved = path.join(fixture, 'retained-original');
    const original = writers.withCheckoutMaintenance;
    vi.spyOn(writers, 'withCheckoutMaintenance').mockImplementation((bases, operation, effect, prepare, outcome) => original(bases, operation,
      () => { renameSync(row.root, saved); mkdirSync(row.root); writeFileSync(path.join(row.root, 'foreign.txt'), 'foreign'); return effect(); }, prepare, outcome));
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_identity_changed');
    expect(existsSync(saved)).toBe(true); expect(readFileSync(path.join(row.root, 'foreign.txt'), 'utf8')).toBe('foreign');
    expect(service.writer(row.id)?.operations[0].receipt?.outcome).toBe('not-applied');
  });
  it('settles an actual native dirty refusal after the last inventory check as not-applied', async () => {
    repository(); const service = createWorktreeService(root, { backend: 'git' }); const row = service.create('worker', { writeSet: ['a.txt'] });
    const native = (await vi.importActual<typeof import('node:child_process')>('node:child_process')).execFileSync;
    vi.spyOn(childProcess, 'execFileSync').mockImplementation(((program: string, args: readonly string[], options: unknown) => {
      if (program === 'git' && args[0] === 'worktree' && args[1] === 'remove') writeFileSync(path.join(row.root, 'a.txt'), 'external B late');
      return native(program, args, options as never);
    }) as typeof childProcess.execFileSync);
    expect(() => service.cleanup(row.id)).toThrow(/modified|untracked/i);
    expect(readFileSync(path.join(row.root, 'a.txt'), 'utf8')).toBe('external B late');
    expect(service.writer(row.id)).toMatchObject({ state: 'released', operations: [{ state: 'settled', receipt: { outcome: 'not-applied' } }] });
    expect(service.list()[0].status).toBe('active');
    proof('native-dirty-refusal', { actualNativeGit: true, record: service.list()[0], writer: service.writer(row.id) });
  });
  it('keeps non-dirty native failures unknown with their writer occupied', async () => {
    repository(); const service = createWorktreeService(root, { backend: 'git' }); const row = service.create('worker');
    const native = (await vi.importActual<typeof import('node:child_process')>('node:child_process')).execFileSync;
    vi.spyOn(childProcess, 'execFileSync').mockImplementation(((program: string, args: readonly string[], options: unknown) => {
      if (program === 'git' && args[0] === 'worktree' && args[1] === 'remove') throw Object.assign(new Error('native EACCES'), { code: 'EACCES' });
      return native(program, args, options as never);
    }) as typeof childProcess.execFileSync);
    expect(() => service.cleanup(row.id)).toThrow('native EACCES'); expect(existsSync(row.root)).toBe(true);
    expect(service.writer(row.id)?.operations[0].state).toBe('unknown'); expect(service.list()[0].status).toBe('cleaning');
  });
  it('uses shared Git refs for committed executable metadata while retaining uncommitted modes', () => {
    repository(); const service = createWorktreeService(root, { backend: 'git' }); const row = service.create('worker');
    execFileSync('git', ['switch', '-c', 'retained-mode'], { cwd: row.root, windowsHide: true });
    execFileSync('git', ['update-index', '--chmod=+x', 'a.txt'], { cwd: row.root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'executable'], { cwd: row.root, windowsHide: true });
    const readModes = snapshot.captureWorktreeModes;
    vi.spyOn(snapshot, 'captureWorktreeModes').mockImplementation(directory => {
      const values = readModes(directory);
      if (directory === row.root) values.set('a.txt', values.get('a.txt')! | 0o111);
      return values;
    });
    service.cleanup(row.id); expect(existsSync(row.root)).toBe(false);
    expect(git('ls-tree', 'retained-mode', '--', 'a.txt')).toContain('100755');
    proof('committed-mode', { actualNativeGit: true, permissionInventory: 'injected-posix-bits-on-Windows', retainedRef: 'retained-mode' });
  });
  it.each(['removed', 'replaced'] as const)('retains unchanged seeded bytes when the target copy is %s', state => {
    writeFileSync(path.join(root, 'a.txt'), 'original bytes'); const service = createWorktreeService(root);
    const row = service.create('worker', { seedFiles: ['a.txt'], writeSet: ['a.txt'] });
    if (state === 'removed') rmSync(path.join(root, 'a.txt')); else writeFileSync(path.join(root, 'a.txt'), 'replacement');
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_unretained_content');
    expect(readFileSync(path.join(row.root, 'a.txt'), 'utf8')).toBe('original bytes');
  });
  it.each(['--assume-unchanged', '--skip-worktree'] as const)('retains actual Git bytes hidden by %s', flag => {
    repository(); const service = createWorktreeService(root, { backend: 'git' }); const row = service.create('worker', { writeSet: ['a.txt'] });
    execFileSync('git', ['update-index', flag, 'a.txt'], { cwd: row.root, windowsHide: true });
    writeFileSync(path.join(row.root, 'a.txt'), 'hidden external bytes');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: row.root, encoding: 'utf8', windowsHide: true }).trim()).toBe('');
    expect(() => assertWorktreeIndexVisible(row.root)).toThrow('worktree_cleanup_hidden_index_flags');
    expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_hidden_index_flags');
    expect(readFileSync(path.join(row.root, 'a.txt'), 'utf8')).toBe('hidden external bytes');
    expect(execFileSync('git', ['ls-files', '-v', 'a.txt'], { cwd: row.root, encoding: 'utf8', windowsHide: true })[0]).toBe(flag === '--assume-unchanged' ? 'h' : 'S');
    proof('hidden-' + flag.slice(2), { actualNativeGit: true, flag, retainedBytes: readFileSync(path.join(row.root, 'a.txt'), 'utf8') });
  });
  it.each([false, true])('uses the managed root baseline instead of unrelated repository permissions (changed=%s)', changed => {
    const modes = snapshot.captureWorktreeModes; let rootMode = 0o700;
    vi.spyOn(snapshot, 'captureWorktreeModes').mockImplementation(directory => {
      const values = modes(directory); if (directory.includes(path.join('.openclaw', 'worktrees'))) values.set('', rootMode);
      return values;
    });
    const service = createWorktreeService(root), row = service.create('worker');
    if (changed) rootMode = 0o750;
    if (changed) expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_unretained_mode:<worktree-root>');
    else { service.cleanup(row.id); expect(existsSync(row.root)).toBe(false); }
    proof('root-mode-' + changed, { permissionInventory: 'injected POSIX directory modes on Windows', changed, rootMode, removed: !existsSync(row.root) });
  });
  it('keeps the original no-force Git dirty refusal for declared edits', () => {
    repository(); const service = createWorktreeService(root, { backend: 'git' }); const row = service.create('worker', { writeSet: ['a.txt'] });
    writeFileSync(path.join(row.root, 'a.txt'), 'external B'); expect(() => service.cleanup(row.id)).toThrow('worktree_cleanup_user_content_present');
    expect(readFileSync(path.join(row.root, 'a.txt'), 'utf8')).toBe('external B');
  });
});
