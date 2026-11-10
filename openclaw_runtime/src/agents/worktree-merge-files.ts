/** File identities for the existing worktree owner; mutations use Coding's journal. */
import { createHash } from "node:crypto";
import { closeSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { openRootFileSync } from "../infra/boundary-file-read.js";

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

