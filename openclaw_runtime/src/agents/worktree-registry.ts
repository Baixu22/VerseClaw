import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import type { DB } from "../state/openclaw-state-db.generated.js";
import { openExecutionStateDatabase as openOpenClawStateDatabase, resolveExecutionStatePath, runExecutionStateWriteTransaction as runOpenClawStateWriteTransaction } from "../state/execution-state-db.js";
import type { MergeQueueItem, WorktreeRecord } from "./worktree-service.js";

export type WorktreeRegistrationPhase = "intent" | "allocated" | "created" | "registered" | "ready";
export type WorktreeRegistration = {
  operationId: string;
  requestDigest: string;
  phase: WorktreeRegistrationPhase;
  rootIdentity?: string;
  nativeIdentity?: string;
};
export type WorktreeRegistryScope = {
  key: string;
  revision: number;
  baseIdentity: string;
  records: Map<string, WorktreeRecord>;
  queue: MergeQueueItem[];
};
export type WorktreeAvailability = "ready" | "incomplete" | "missing" | "replaced" | "unknown" | "cleaned";
type RegistryDatabase = Pick<DB, "managed_worktree_scopes">;

export function canonicalWorktreePath(root: string): string {
  const actual = realpathSync.native(root).replace(/^\\\\\?\\UNC\\/u, "\\\\").replace(/^\\\\\?\\/u, "");
  return process.platform === "win32" ? actual.toLowerCase() : actual;
}

function literalRoot(root: string): string {
  const actual = path.resolve(root.replace(/^\\\\\?\\UNC\\/u, "\\\\").replace(/^\\\\\?\\/u, ""));
  return process.platform === "win32" ? actual.toLowerCase() : actual;
}

/** Creation identity is independent of mutable content and directory mtime. */
export function filesystemInstance(root: string): string {
  const stat = statSync(root, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

export function worktreeNativeIdentity(root: string, backend: WorktreeRecord["backend"]): string {
  if (lstatSync(root).isSymbolicLink()) throw new Error("worktree_root_redirected");
  const identity = filesystemInstance(root);
  if (backend !== "git") return identity;
  const marker = readFileSync(path.join(root, ".git"), "utf8");
  const match = /^gitdir:\s*(.+)\s*$/mu.exec(marker);
  if (!match) throw new Error("worktree_git_binding_invalid");
  const gitDir = canonicalWorktreePath(path.resolve(root, match[1].trim()));
  const backPointer = readFileSync(path.join(gitDir, "gitdir"), "utf8").trim();
  const commonPointer = readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
  if (canonicalWorktreePath(path.dirname(backPointer)) !== canonicalWorktreePath(root)) {
    throw new Error("worktree_git_binding_mismatch");
  }
  return createHash("sha256").update(JSON.stringify([
    identity, gitDir, filesystemInstance(gitDir), marker, commonPointer,
    canonicalWorktreePath(path.resolve(gitDir, commonPointer)),
  ])).digest("hex");
}

export function observeWorktree(record: WorktreeRecord): WorktreeAvailability {
  if (record.status === "cleaned") return "cleaned";
  try {
    const rootIdentity = filesystemInstance(record.root);
    if (record.registration.rootIdentity && rootIdentity !== record.registration.rootIdentity) return "replaced";
    if (record.registration.nativeIdentity && worktreeNativeIdentity(record.root, record.backend) !== record.registration.nativeIdentity) return "replaced";
    return record.registration.phase === "ready" && record.status !== "cleaning" ? "ready" : "incomplete";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unknown";
  }
}

export function loadWorktreeRegistryScope(baseRoot: string, readOnly = false): WorktreeRegistryScope {
  const key = canonicalWorktreePath(baseRoot);
  const baseIdentity = filesystemInstance(baseRoot);
  const db = readOnly ? new DatabaseSync(resolveExecutionStatePath(), { readOnly: true }) : openOpenClawStateDatabase().db;
  const row = (() => {
    try {
      const query = getNodeSqliteKysely<RegistryDatabase>(db);
      return executeSqliteQueryTakeFirstSync(db, query.selectFrom("managed_worktree_scopes").selectAll().where("scope_key", "=", key));
    } finally { if (readOnly) db.close(); }
  })();
  if (!row) return { key, baseIdentity, revision: 0, records: new Map(), queue: [] };
  const data = JSON.parse(row.state_json) as {
    schema?: number; baseIdentity?: string; records?: WorktreeRecord[]; queue?: MergeQueueItem[];
  };
  if (data.schema !== 1 || !Array.isArray(data.records) || !Array.isArray(data.queue)
    || new Set(data.records.map(record => record.id)).size !== data.records.length
    || data.records.some(record => !record.id || !record.generation || !record.registration?.operationId
      || !["intent", "allocated", "created", "registered", "ready"].includes(record.registration.phase)
      || (record.registration.phase !== "intent" && !record.registration.rootIdentity)
      || (["created", "registered", "ready"].includes(record.registration.phase) && !record.registration.nativeIdentity)
      || literalRoot(record.root) !== literalRoot(path.join(baseRoot, ".openclaw", "worktrees", record.id)))) {
    throw new Error("worktree_registry_invalid");
  }
  if (data.baseIdentity !== baseIdentity) throw new Error("worktree_base_incarnation_changed");
  for (const record of data.records) {
    const baseline = record.mergeBaseline;
    if (baseline) {
      if (Array.isArray(baseline.parent)) baseline.parent = Object.fromEntries(baseline.parent);
      if (Array.isArray(baseline.worker)) baseline.worker = Object.fromEntries(baseline.worker);
    }
    const legacy = record as WorktreeRecord & { lastMerge?: MergeQueueItem };
    if (legacy.lastMerge) {
      if (record.mergeResult && !isDeepStrictEqual(record.mergeResult, legacy.lastMerge)) {
        throw new Error('worktree_merge_receipt_conflict');
      }
      record.mergeResult = legacy.lastMerge;
      delete legacy.lastMerge;
    }
  }
  return { key, baseIdentity, revision: row.revision, records: new Map(data.records.map(record => [record.id, record])), queue: data.queue };
}

/** Resolve an execution root through existing registrations, including after restart. */
export function findManagedWorktreeByRoot(root: string): { baseRoot: string; record: WorktreeRecord } | null {
  const canonicalRoot = canonicalWorktreePath(root);
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<RegistryDatabase>(db);
  const rows = executeSqliteQuerySync(db, query.selectFrom("managed_worktree_scopes").select(["scope_key", "state_json"])).rows;
  let match: { baseRoot: string; record: WorktreeRecord } | null = null;
  for (const row of rows) {
    const data = JSON.parse(row.state_json) as { records?: WorktreeRecord[] };
    if (!Array.isArray(data.records)) throw new Error("worktree_registry_invalid");
    const candidate = data.records.find(record => typeof record.root === "string" && literalRoot(record.root) === canonicalRoot);
    if (!candidate) continue;
    const record = loadWorktreeRegistryScope(row.scope_key).records.get(candidate.id);
    if (!record || literalRoot(record.root) !== canonicalRoot) throw new Error("worktree_registry_invalid");
    if (match) throw new Error("worktree_execution_owner_ambiguous");
    match = { baseRoot: row.scope_key, record };
  }
  return match;
}

/** Only short metadata transactions hold the shared database lock; Git runs outside it. */
export function saveWorktreeRegistryScope(scope: WorktreeRegistryScope): void {
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<RegistryDatabase>(db);
    const values = {
      revision: scope.revision + 1,
      state_json: JSON.stringify({ schema: 1, baseIdentity: scope.baseIdentity, records: [...scope.records.values()], queue: scope.queue }),
      updated_at: Date.now(),
    };
    const result = scope.revision === 0
      ? executeSqliteQuerySync(db, query.insertInto("managed_worktree_scopes").values({ scope_key: scope.key, ...values }).onConflict(c => c.column("scope_key").doNothing()))
      : executeSqliteQuerySync(db, query.updateTable("managed_worktree_scopes").set(values).where("scope_key", "=", scope.key).where("revision", "=", scope.revision));
    if (result.numAffectedRows !== 1n) throw new Error("worktree_registry_revision_conflict");
  });
  scope.revision += 1;
}
