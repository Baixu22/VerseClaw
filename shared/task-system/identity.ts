import { createHash } from "node:crypto";
import { existsSync, realpathSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type TaskDomain = { id: string; root: string; database: string; worktree: string };

export type TaskAuthorityBasis = {
  localDomainId: string;
  authorityId: string;
  authorityDatabase: string;
  executionWorktree: string;
  registrationRevision: number | null;
  projectRevision: number | null;
  identityDigest: string;
  databaseIdentity?: string;
};

export type TaskAuthorityAccess = {
  domain: TaskDomain;
  assertCurrent(): void;
  resolveRelated(workspaceRoot: string): TaskDomain;
  withWriteBarrier?<T>(operation: () => T): T;
};

export function canonicalPath(input: string): string {
  const full = realpathSync
    .native(resolve(input))
    .replace(/^\\\\\?\\UNC\\/, "\\\\")
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/");
  return process.platform === "win32" ? full.toLowerCase() : full;
}

/** Worktree paths never participate in the task exclusivity key. */
export function resolveTaskDomain(workspaceRoot: string): TaskDomain {
  if (!workspaceRoot?.trim()) throw new Error("TASK_WORKSPACE_REQUIRED");
  const worktree = canonicalPath(workspaceRoot);
  let cursor = worktree;
  let gitFound = false;
  while (true) {
    if (existsSync(join(cursor, ".git"))) {
      gitFound = true;
      break;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  let root = worktree;
  if (gitFound) {
    // A broken Git binding must not fall back to a different lock namespace.
    const marker = join(cursor, ".git");
    if (statSync(marker).isDirectory()) root = canonicalPath(marker);
    else {
      const match = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(marker, "utf8"));
      if (!match) throw new Error("TASK_GIT_BINDING_INVALID");
      const privateDir = canonicalPath(resolve(cursor, match[1].trim()));
      root = existsSync(join(privateDir, "commondir"))
        ? canonicalPath(
            resolve(privateDir, readFileSync(join(privateDir, "commondir"), "utf8").trim()),
          )
        : privateDir;
    }
  }
  let database = join(root, gitFound ? "verse-claw" : ".verse-claw", "task-ledger.sqlite3");
  // Runtime bootstrap can initialize Git after a local task already exists.
  // Keep that task domain, including for later linked worktrees.
  if (gitFound && basename(root) === ".git") {
    const anchor = canonicalPath(dirname(root));
    const legacyDatabase = join(anchor, ".verse-claw", "task-ledger.sqlite3");
    if (existsSync(legacyDatabase)) {
      if (existsSync(database)) throw new Error("TASK_DOMAIN_STORES_CONFLICT");
      root = anchor;
      database = legacyDatabase;
    }
  }
  return {
    id: createHash("sha256").update(root).digest("hex"),
    root,
    worktree,
    database,
  };
}
