/** File identities for the existing worktree owner; mutations use Coding's journal. */
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { openRootFileSync } from "../infra/boundary-file-read.js";

import { root as fsRoot } from "../infra/fs-safe.js";
import { journaledGitApply } from "../plugin-sdk/journaled-git-apply.js";
export type WorktreeFileBaseline = { parent: Map<string, string>; worker: Map<string, string> };
const excluded = new Set([".git", ".openclaw", "node_modules"]);
export function worktreeContentHash(bytes: Buffer | null): string | null {
  return bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
}

export function readWorktreeFile(root: string, relative: string): Buffer | null {
  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (!rel || path.isAbsolute(rel) || rel.split(path.sep).some((part) => part === ".." || excluded.has(part.toLowerCase()))) {
    throw new Error(`worktree_merge_unsafe_path:${relative}`);
  }
  const opened = openRootFileSync({ absolutePath: absolute, rootPath: root, boundaryLabel: "worktree merge", rejectHardlinks: true });
  if (!opened.ok) {
    if ((opened.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw new Error(`worktree_merge_unsafe_file:${relative}:${opened.reason}`);
  }
  try { return readFileSync(opened.fd); }
  finally { closeSync(opened.fd); }
}

/** No second persistent index: this snapshot lives only in the existing worktree registry. */
export function captureWorktreeFiles(root: string, includeInternal = false): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (prefix: string) => {
    for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded.has(entry.name.toLowerCase())) {
        if (includeInternal) files.set(rel, 'unsupported-file-identity');
        continue;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(rel);
      else if (entry.isSymbolicLink() || !entry.isFile() || lstatSync(path.join(root, rel)).nlink > 1) {
        files.set(rel, "unsupported-file-identity");
      } else {
        const hash = worktreeContentHash(readWorktreeFile(root, rel));
        if (hash === null) throw new Error(`worktree_snapshot_changed:${rel}`);
        files.set(rel, hash);
      }
    }
  };
  walk("");
  return files;
}

/** Metadata stays in the same registry baseline and is checked before destructive cleanup. */
export function captureWorktreeModes(root: string): Map<string, number> {
  const modes = new Map<string, number>([['', lstatSync(root).mode & 0o7777]]);
  const walk = (prefix: string) => {
    for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
      if (excluded.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      modes.set(relative, lstatSync(path.join(root, relative)).mode & 0o7777);
      if (entry.isDirectory()) walk(relative);
    }
  };
  walk('');
  return modes;
}

export function changedWorktreeFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file)).sort();
}


export function nativeFilename(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) return relative;
  const parts: string[] = [];
  const requestedParts = relative.split('/');
  for (let index = 0; index < requestedParts.length; index++) {
    const part = requestedParts[index]!;
    const parent = path.join(root, ...parts);
    let names: string[];
    try { names = readdirSync(parent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [...parts, ...requestedParts.slice(index)].join('/'); throw error; }
    if (names.includes(part)) { parts.push(part); continue; }
    // Only an alias resolved by this filesystem may stand in for another spelling.
    let requested: ReturnType<typeof lstatSync>;
    try { requested = lstatSync(path.join(parent, part)); } catch { return [...parts, ...requestedParts.slice(index)].join('/'); }
    const native = names.find(value => {
      if (value.toLowerCase() !== part.toLowerCase()) return false;
      const actual = lstatSync(path.join(parent, value));
      return actual.dev === requested.dev && actual.ino === requested.ino;
    });
    parts.push(native ?? part);
  }
  return parts.join('/');
}

export async function applyWorktreeFiles(input: {
  baseRoot: string;
  workerRoot: string;
  sessionKey: string;
  baseline: WorktreeFileBaseline;
  files: string[];
  expectedPostimages?: Record<string, string | null>;
  assertCurrent: () => void;
  beforeApply?: (journalRef: string, hashes: Record<string, string | null>) => void;
  beforeEffect?: () => void;
}): Promise<{ success: boolean; reason?: string; journalRef?: string; recoveryRequired?: boolean; hashes?: Record<string, string | null> }> {
  let target: Awaited<ReturnType<typeof fsRoot>>;
  let postimages: Map<string, Buffer | null>;
  let originals: Map<string, Buffer | null>;
  let workerModes: Map<string, number | null>;
  let parentModes: Map<string, number | null>;
  try {
    target = await fsRoot(input.baseRoot);
    postimages = new Map(input.files.map((file) => [file, readWorktreeFile(input.workerRoot, file)]));
    originals = new Map(input.files.map((file) => [file, readWorktreeFile(input.baseRoot, file)]));
    workerModes = new Map(input.files.map(file => [file, postimages.get(file) === null ? null : lstatSync(path.join(input.workerRoot, file)).mode & 0o7777]));
    parentModes = new Map(input.files.map(file => [file, originals.get(file) === null ? null : lstatSync(path.join(input.baseRoot, file)).mode & 0o7777]));
  } catch (error) {
    return { success: false, reason: `preflight:${error instanceof Error ? error.message : String(error)}` };
  }
  const identity = (file: string) => nativeFilename(existsSync(path.join(input.baseRoot, file)) ? input.baseRoot : input.workerRoot, file);
  if (input.expectedPostimages) {
    const expected = new Map(Object.entries(input.expectedPostimages).map(([file, hash]) => [identity(file), hash]));
    const actual = new Set(input.files.map(identity));
    if (expected.size !== actual.size || [...expected.keys()].some(file => !actual.has(file))) {
      return { success: false, reason: 'frozen_candidate_changed:paths' };
    }
    for (const file of input.files) {
      if (worktreeContentHash(postimages.get(file)!) !== expected.get(identity(file))) return { success: false, reason: 'frozen_candidate_changed:' + file };
    }
  }
  const parent = new Map([...input.baseline.parent].map(([file, hash]) => [identity(file), hash]));
  const worker = new Map([...input.baseline.worker].map(([file, hash]) => [identity(file), hash]));
  for (const file of input.files) {
    const initialParent = parent.get(identity(file)) ?? null;
    const initialWorker = worker.get(identity(file)) ?? null;
    const current = worktreeContentHash(originals.get(file)!);
    const wanted = worktreeContentHash(postimages.get(file)!);
    if (current !== wanted && (initialParent !== initialWorker || current !== initialParent)) {
      return { success: false, reason: `base_content_changed:${file}` };
    }
  }
  const renames = new Map<string, { from: string; to: string }>();
  try {
  for (const file of input.files) {
    if (postimages.get(file) === null) continue;
    const parts = file.split('/');
    for (let count = 1; count < parts.length; count++) {
      const directory = parts.slice(0, count).join('/');
      const wanted = lstatSync(path.join(input.workerRoot, directory)).mode & 0o7777;
      const targetPath = path.join(input.baseRoot, directory);
      const current = existsSync(targetPath) ? lstatSync(targetPath).mode & 0o7777 : process.platform === 'win32' ? 0o666 : 0o777 & ~process.umask();
      if (wanted !== current) return { success: false, reason: 'worktree_merge_mode_unsupported' };
    }
  }
  for (const file of input.files) {
    if (originals.get(file) === null || postimages.get(file) === null) continue;
    const from = nativeFilename(input.baseRoot, file), to = nativeFilename(input.workerRoot, file);
    if (from !== to && from.toLowerCase() === to.toLowerCase()) renames.set(file, { from, to });
  }
  for (const file of input.files) {
    const wantedMode = workerModes.get(file), priorMode = parentModes.get(file);
    if (wantedMode === null) continue;
    if ((priorMode !== null && wantedMode !== priorMode)
      || (process.platform !== 'win32' && priorMode === null && (wantedMode! & 0o111))) {
      return { success: false, reason: 'worktree_merge_mode_unsupported' };
    }
  }
  } catch (error) {
    return { success: false, reason: 'preflight:' + (error instanceof Error ? error.message : String(error)) };
  }
  const changed = input.files.filter((file) => renames.has(file) || worktreeContentHash(originals.get(file)!) !== worktreeContentHash(postimages.get(file)!));
  const assertFrozen = () => {
    input.assertCurrent();
    for (const [file, bytes] of postimages) {
      if (worktreeContentHash(readWorktreeFile(input.workerRoot, file)) !== worktreeContentHash(bytes)
        || (bytes !== null && (lstatSync(path.join(input.workerRoot, file)).mode & 0o7777) !== workerModes.get(file))) {
        throw new Error(`worker_changed_before_apply:${file}`);
      }
    }
  };
  const validate = async () => {
    assertFrozen();
    for (const [file, bytes] of originals) {
      if (worktreeContentHash(readWorktreeFile(input.baseRoot, file)) !== worktreeContentHash(bytes)
        || (bytes !== null && (lstatSync(path.join(input.baseRoot, file)).mode & 0o7777) !== parentModes.get(file))) {
        throw new Error(`base_changed_before_apply:${file}`);
      }
    }
  };
  const hashes = Object.fromEntries([...postimages].map(([file, bytes]) => [file, worktreeContentHash(bytes)]));
  if (!changed.length) {
    try { await validate(); return { success: true, hashes }; }
    catch (error) { return { success: false, reason: `preflight:${error instanceof Error ? error.message : String(error)}` }; }
  }
  const appliedPaths = new Set<string>();
  let filenameEffect = false;
  let prepared = false;
  let effectStarted = false;
  const beginEffect = () => {
    if (!effectStarted) { input.beforeEffect?.(); effectStarted = true; }
  };
  let preparedRef: string | undefined;
  let outcome: { result?: { success: boolean }; journalRef?: string; error?: string; recoveryRequired?: boolean };
  try {
  outcome = await journaledGitApply({
    workspaceRoot: input.baseRoot,
    sessionKey: input.sessionKey,
    paths: changed.map((file) => path.join(input.baseRoot, file)),
    expectedPostimages: new Map(changed.map((file) => [path.resolve(input.baseRoot, file), postimages.get(file)!])),
    appliedPaths,
    onPrepared: journalRef => { input.beforeApply?.(journalRef, hashes); preparedRef = journalRef; prepared = true; },
    canRollback: () => !filenameEffect,
    validate,
    preflight: async () => ({ success: true }),
    apply: async () => {
      for (const file of changed) {
        assertFrozen();
        if (worktreeContentHash(readWorktreeFile(input.baseRoot, file)) !== worktreeContentHash(originals.get(file)!)) {
          throw new Error(`base_changed_before_write:${file}`);
        }
        const bytes = postimages.get(file)!;
        const rename = renames.get(file);
        if (rename) {
          filenameEffect = true;
          const from = rename.from.split('/'), to = rename.to.split('/');
          for (let index = 0; index < from.length; index++) {
            if (from[index] !== to[index]) { beginEffect(); await target.move([...to.slice(0, index), from[index]].join('/'), to.slice(0, index + 1).join('/'), { overwrite: true }); }
          }
        }
        if (bytes === null) { beginEffect(); await target.remove(file); }
        else if (worktreeContentHash(originals.get(file)!) !== worktreeContentHash(bytes)) {
          beginEffect(); await target.write(rename?.to ?? file, bytes, { mkdir: true,
            ...(originals.get(file) === null ? { mode: workerModes.get(file)! } : {}) });
        }
        appliedPaths.add(path.resolve(input.baseRoot, file));
      }
      assertFrozen();
      const success = input.files.every((file) => worktreeContentHash(readWorktreeFile(input.baseRoot, file)) === hashes[file]);
      return { success };
    },
  });
  } catch (error) {
    return { success: false, reason: `${prepared ? 'journal' : 'preflight'}:${error instanceof Error ? error.message : String(error)}`,
      recoveryRequired: effectStarted, journalRef: preparedRef, hashes };
  }
  return {
    success: outcome.result?.success === true && !outcome.recoveryRequired,
    reason: outcome.error ?? (outcome.recoveryRequired ? "journal_recovery_required" : outcome.result?.success ? undefined : "post_apply_mismatch"),
    journalRef: outcome.journalRef,
    recoveryRequired: outcome.recoveryRequired && effectStarted,
    hashes,
  };
}
