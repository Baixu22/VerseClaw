// @vitest-environment node
/**
 * FP-P1-02: workspace preflight + boundary escape coverage.
 *
 * Preflight decision table (pure + real-fs), sensitive-path classification,
 * single-authority sync (agents.defaults.workspace follows the active profile),
 * and the escape cases the task hard-locks: `../` traversal and symlink
 * escape must be judged AFTER realpath resolution.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isSensitiveWorkspacePath,
  runWorkspacePreflight,
  summarizePreflight,
  type WorkspacePreflightCheck,
} from '@electron/services/workspace-preflight';
import {
  decideWorkspaceFileWrite,
  decideWorkspaceFileWriteResolved,
} from '@electron/services/workspace-permissions';
import type { WorkspaceProfile } from '@shared/types/workspace';

let baseDir: string;

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'fp-p1-02-'));
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true }).catch(() => undefined);
});

function workspace(rootPath: string, permissionMode: WorkspaceProfile['permissionMode']): WorkspaceProfile {
  return {
    id: 'ws-test',
    name: 'test',
    rootPath,
    agentId: 'main',
    permissionMode,
    createdAt: 0,
    updatedAt: 0,
  } as WorkspaceProfile;
}

describe('FP-P1-02 isSensitiveWorkspacePath', () => {
  it('blocks drive/home/system/credential roots', () => {
    expect(isSensitiveWorkspacePath('C:\\').level).toBe('fail');
    expect(isSensitiveWorkspacePath(homedir()).level).toBe('fail');
    expect(isSensitiveWorkspacePath('C:\\Windows\\System32').level).toBe('fail');
    expect(isSensitiveWorkspacePath('C:\\Program Files\\Something').level).toBe('fail');
    expect(isSensitiveWorkspacePath(join(homedir(), '.ssh')).level).toBe('fail');
  });

  it('allows ordinary project folders (including inside home)', () => {
    expect(isSensitiveWorkspacePath(join(homedir(), 'projects', 'demo')).level).toBe('ok');
    expect(isSensitiveWorkspacePath('D:\\work\\repo').level).toBe('ok');
  });
});

describe('FP-P1-02 summarizePreflight decision table', () => {
  const check = (id: WorkspacePreflightCheck['id'], status: WorkspacePreflightCheck['status']): WorkspacePreflightCheck =>
    ({ id, status, detail: 'x' });

  it('all ok → usable, writable', () => {
    expect(summarizePreflight([check('exists', 'ok'), check('writable', 'ok')])).toEqual({
      ok: true,
      readOnlyOnly: false,
    });
  });

  it('missing/unreadable/sensitive fail → blocked outright', () => {
    for (const id of ['exists', 'readable', 'sensitivePath'] as const) {
      expect(summarizePreflight([check(id, 'fail')]).ok).toBe(false);
    }
  });

  it('only writable fails → usable but read-only (explicit degradation, not silent)', () => {
    expect(
      summarizePreflight([check('exists', 'ok'), check('readable', 'ok'), check('writable', 'fail')]),
    ).toEqual({ ok: true, readOnlyOnly: true });
  });

  it('warnings never block', () => {
    expect(
      summarizePreflight([check('exists', 'ok'), check('sensitivePath', 'warn'), check('diskSpace', 'warn')]).ok,
    ).toBe(true);
  });
});

describe('FP-P1-02 runWorkspacePreflight (real fs)', () => {
  it('preflights a real home directory through the same tilde target as workspace creation', async () => {
    const dir = await mkdtemp(join(homedir(), '.clawx-preflight-tilde-'));
    try {
      const input = `  ~/${basename(dir)}  `;
      const absolute = await runWorkspacePreflight(dir);
      const tilde = await runWorkspacePreflight(input);
      expect(tilde.rootPath).toBe(input);
      expect(tilde.resolvedPath).toBe(absolute.resolvedPath);
      expect(tilde.ok).toBe(true);
      expect(tilde.readOnlyOnly).toBe(absolute.readOnlyOnly);
      expect(tilde.checks.find(check => check.id === 'exists')).toMatchObject({ status: 'ok', detail: 'directory' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects the home root after expanding a tilde input', async () => {
    const result = await runWorkspacePreflight(' ~ ');
    expect(result.ok).toBe(false);
    expect(result.checks.find(check => check.id === 'sensitivePath')).toMatchObject({ status: 'fail', detail: 'homeRoot' });
  });

  it('a normal directory passes with git=no', async () => {
    const dir = join(baseDir, 'plain');
    await mkdir(dir, { recursive: true });
    const result = await runWorkspacePreflight(dir);
    expect(result.ok).toBe(true);
    expect(result.readOnlyOnly).toBe(false);
    expect(result.isGitRepo).toBe(false);
    expect(result.checks.find((c) => c.id === 'git')?.detail).toBe('notGitRepo');
  });

  it('a git repo is reported (drives the undo-strategy hint)', async () => {
    const dir = join(baseDir, 'repo');
    await mkdir(join(dir, '.git'), { recursive: true });
    const result = await runWorkspacePreflight(dir);
    expect(result.isGitRepo).toBe(true);
  });

  it('a missing path is blocked with an explaining check', async () => {
    const result = await runWorkspacePreflight(join(baseDir, 'nope-does-not-exist'));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === 'exists')?.detail).toBe('missing');
  });

  it('credential material inside the folder is surfaced as a warning', async () => {
    const dir = join(baseDir, 'creds');
    await mkdir(join(dir, '.ssh'), { recursive: true });
    const result = await runWorkspacePreflight(dir);
    expect(result.ok).toBe(true);
    const sensitive = result.checks.find((c) => c.id === 'sensitivePath');
    expect(sensitive?.status).toBe('warn');
    expect(sensitive?.detail).toContain('.ssh');
  });
});

describe('FP-P1-02 write-boundary escapes', () => {
  it('`../` traversal is judged against the resolved target, not the raw string', async () => {
    const root = join(baseDir, 'boundary-root');
    await mkdir(root, { recursive: true });
    const escapePath = join(root, 'sub', '..', '..', 'outside.txt');
    const ws = workspace(root, 'acceptEdits');
    const decision = await decideWorkspaceFileWriteResolved(escapePath, ws);
    expect(decision.allowed).toBe(false);
    expect(decision.risk).toBe('external-write');
    // The denial names the actual boundary (AC: 错误里能读出「越界」与实际边界).
    expect(decision.reason).toContain('outside the workspace boundary');
    expect(decision.reason).toContain(root);
  });

  it('symlink escape is judged after realpath (hard lock)', async () => {
    const root = join(baseDir, 'sym-root');
    const outside = join(baseDir, 'sym-outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    const linkPath = join(root, 'link');
    try {
      await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      console.warn('symlink unsupported in this environment; skipping', error);
      return;
    }
    await writeFile(join(outside, 'target.txt'), 'x', 'utf8');
    const ws = workspace(root, 'acceptEdits');
    // Lexically inside (root/link/target.txt) but realpath escapes.
    const decision = await decideWorkspaceFileWriteResolved(join(linkPath, 'target.txt'), ws);
    expect(decision.allowed).toBe(false);
    expect(decision.risk).toBe('external-write');
  });

  it('readOnly mode rejects even in-workspace writes', () => {
    const root = resolve(join(baseDir, 'ro-root'));
    const decision = decideWorkspaceFileWrite(join(root, 'file.txt'), workspace(root, 'readOnly'));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Read-only');
  });

  it('acceptEdits allows in-workspace writes without approval', () => {
    const root = resolve(join(baseDir, 'ok-root'));
    const decision = decideWorkspaceFileWrite(join(root, 'file.txt'), workspace(root, 'acceptEdits'));
    expect(decision.allowed).toBe(true);
    expect(decision.risk).toBe('write');
  });
});
