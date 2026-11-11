/** File identities for the existing worktree owner; mutations use Coding's journal. */
import { createHash } from "node:crypto";
import { closeSync, lstatSync, readFileSync, readdirSync } from "node:fs";
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

export async function applyWorktreeFiles(input: {
  baseRoot: string;
  workerRoot: string;
  sessionKey: string;
  baseline: WorktreeFileBaseline;
  files: string[];
  assertCurrent: () => void;
}): Promise<{ success: boolean; reason?: string; journalRef?: string; recoveryRequired?: boolean; hashes?: Record<string, string | null> }> {
  const target = await fsRoot(input.baseRoot);
  const postimages = new Map(input.files.map((file) => [file, readWorktreeFile(input.workerRoot, file)]));
  const originals = new Map(input.files.map((file) => [file, readWorktreeFile(input.baseRoot, file)]));
  for (const file of input.files) {
    const initialParent = input.baseline.parent.get(file) ?? null;
    const initialWorker = input.baseline.worker.get(file) ?? null;
    const current = worktreeContentHash(originals.get(file)!);
    const wanted = worktreeContentHash(postimages.get(file)!);
    if (current !== wanted && (initialParent !== initialWorker || current !== initialParent)) {
      return { success: false, reason: `base_content_changed:${file}` };
    }
  }
  const changed = input.files.filter((file) => worktreeContentHash(originals.get(file)!) !== worktreeContentHash(postimages.get(file)!));
  const assertFrozen = () => {
    input.assertCurrent();
    for (const [file, bytes] of postimages) {
      if (worktreeContentHash(readWorktreeFile(input.workerRoot, file)) !== worktreeContentHash(bytes)) {
        throw new Error(`worker_changed_before_apply:${file}`);
      }
    }
  };
  const validate = async () => {
    assertFrozen();
    for (const [file, bytes] of originals) {
      if (worktreeContentHash(readWorktreeFile(input.baseRoot, file)) !== worktreeContentHash(bytes)) {
        throw new Error(`base_changed_before_apply:${file}`);
      }
    }
  };
  const hashes = Object.fromEntries([...postimages].map(([file, bytes]) => [file, worktreeContentHash(bytes)]));
  if (!changed.length) { await validate(); return { success: true, hashes }; }
  const outcome = await journaledGitApply({
    workspaceRoot: input.baseRoot,
    sessionKey: input.sessionKey,
    paths: changed.map((file) => path.join(input.baseRoot, file)),
    expectedPostimages: new Map(changed.map((file) => [path.resolve(input.baseRoot, file), postimages.get(file)!])),
    validate,
    preflight: async () => ({ success: true }),
    apply: async () => {
      for (const file of changed) {
        assertFrozen();
        if (worktreeContentHash(readWorktreeFile(input.baseRoot, file)) !== worktreeContentHash(originals.get(file)!)) {
          throw new Error(`base_changed_before_write:${file}`);
        }
        const bytes = postimages.get(file)!;
        if (bytes === null) await target.remove(file);
        else await target.write(file, bytes, { mkdir: true });
      }
      assertFrozen();
      const success = input.files.every((file) => worktreeContentHash(readWorktreeFile(input.baseRoot, file)) === hashes[file]);
      return { success };
    },
  });
  return {
    success: outcome.result?.success === true && !outcome.recoveryRequired,
    reason: outcome.error ?? (outcome.recoveryRequired ? "journal_recovery_required" : outcome.result?.success ? undefined : "post_apply_mismatch"),
    journalRef: outcome.journalRef,
    recoveryRequired: outcome.recoveryRequired,
    hashes,
  };
}
