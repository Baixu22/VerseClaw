// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTaskCompletionCandidate, readTaskCompletionCandidateAsync } from '../../shared/task-ledger-candidate';

const bytes = vi.hoisted(() => ({ malformedGitNames: false }));
const special = vi.hoisted(() => ({ path: '', modePath: '', mode: 0o755 }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, lstatSync: (...args: Parameters<typeof actual.lstatSync>) => {
    if (String(args[0]) === special.path) return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false };
    const result = Reflect.apply(actual.lstatSync, null, args);
    return result && actual.realpathSync(String(args[0])).replaceAll('\\','/').toLowerCase() === special.modePath.replaceAll('\\','/').toLowerCase() ? Object.assign(result, { mode: (Number(result.mode) & ~0o777) | special.mode }) : result;
  }, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (String(args[0]) === special.path) throw new Error('Special source bytes were read');
    return Reflect.apply(actual.readFileSync, null, args);
  } };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: async (...args: Parameters<typeof actual.lstat>) => {
    if (String(args[0]) === special.path) return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false };
    const result = await Reflect.apply(actual.lstat, null, args);
    return (await actual.realpath(String(args[0]))).replaceAll('\\','/').toLowerCase() === special.modePath.replaceAll('\\','/').toLowerCase() ? Object.assign(result, { mode: (Number(result.mode) & ~0o777) | special.mode }) : result;
  }, readFile: (...args: Parameters<typeof actual.readFile>) => {
    if (String(args[0]) === special.path) throw new Error('Special source bytes were read');
    return Reflect.apply(actual.readFile, null, args);
  } };
});
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const invalid = Buffer.from([0x31, 0x30, 0x30, 0x36, 0x34, 0x34, 0x20, 0xff, 0x00]);
  return { ...actual,
    execFileSync: (...args: Parameters<typeof actual.execFileSync>) => bytes.malformedGitNames && (args[1] as string[]).includes('ls-files')
      ? invalid : actual.execFileSync(...args),
    execFile: (...args: Parameters<typeof actual.execFile>) => {
      if (bytes.malformedGitNames && (args[1] as string[]).includes('ls-files')) {
        const callback = args.at(-1) as (error: Error | null, stdout: Buffer, stderr: Buffer) => void;
        queueMicrotask(() => callback(null, invalid, Buffer.alloc(0)));
        return {};
      }
      return Reflect.apply(actual.execFile, null, args);
    },
  };
});

const roots: string[] = [];
afterEach(() => { bytes.malformedGitNames = false; special.path = ''; special.modePath = ''; special.mode = 0o755; for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('candidate physical input decoding', () => {
  it('rejects special-file input before attempting an unbounded source read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'a3-special-source-')); roots.push(root);
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    git(['init', '--initial-branch=main']); writeFileSync(join(root, 'source.cjs'), 'regular file at intake');
    git(['add', '.']); git(['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'file-type fixture']);
    special.path = join(root, 'source.cjs');
    expect(() => readTaskCompletionCandidate(root, 'a'.repeat(64))).toThrow('not a regular file');
    await expect(readTaskCompletionCandidateAsync(root, 'a'.repeat(64))).rejects.toThrow('not a regular file');
  });
  it('rejects malformed filename bytes in both real candidate-reader paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'a3-filename-bytes-')); roots.push(root);
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    git(['init', '--initial-branch=main']); writeFileSync(join(root, 'source.cjs'), 'physical source');
    git(['add', '.']); git(['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-m', 'filename fixture']);
    bytes.malformedGitNames = true;
    expect(() => readTaskCompletionCandidate(root, 'a'.repeat(64))).toThrow(/encoded data/u);
    await expect(readTaskCompletionCandidateAsync(root, 'a'.repeat(64))).rejects.toThrow(/encoded data/u);
  });
});

describe('candidate executable input modes', () => {
  it('invalidates untracked input when only execution permission changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'a3-untracked-mode-')); roots.push(root);
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    git(['init','--initial-branch=main']);writeFileSync(join(root,'tracked.cjs'),'intake source');
    git(['add','.']);git(['-c','user.name=Agent','-c','user.email=agent@example.invalid','commit','-m','mode fixture']);
    const script=join(root,'untracked.sh');writeFileSync(script,'#!/bin/sh\nexit 0\n');special.modePath=script;special.mode=0o755;
    const before=readTaskCompletionCandidate(root,'a'.repeat(64));expect(await readTaskCompletionCandidateAsync(root,'a'.repeat(64))).toEqual(before);
    special.mode=0o644;const after=readTaskCompletionCandidate(root,'a'.repeat(64));
    expect(after.dirtyDiffSha256).not.toBe(before.dirtyDiffSha256);expect(await readTaskCompletionCandidateAsync(root,'a'.repeat(64))).toEqual(after);
  });
  it('invalidates linked physical input when only target execution permission changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'a3-linked-mode-')); roots.push(root);
    const target=mkdtempSync(join(tmpdir(),'a3-external-mode-'));roots.push(target);
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
    git(['init','--initial-branch=main']);writeFileSync(join(root,'tracked.cjs'),'intake source');git(['add','.']);git(['-c','user.name=Agent','-c','user.email=agent@example.invalid','commit','-m','linked mode fixture']);
    const script=join(target,'program.sh');writeFileSync(script,'#!/bin/sh\nexit 0\n');symlinkSync(target,join(root,'linked'),process.platform==='win32'?'junction':'dir');special.modePath=script;special.mode=0o755;
    const before=readTaskCompletionCandidate(root,'a'.repeat(64));expect(await readTaskCompletionCandidateAsync(root,'a'.repeat(64))).toEqual(before);
    special.mode=0o644;const after=readTaskCompletionCandidate(root,'a'.repeat(64));expect(after.dirtyDiffSha256).not.toBe(before.dirtyDiffSha256);expect(await readTaskCompletionCandidateAsync(root,'a'.repeat(64))).toEqual(after);
  });
});
