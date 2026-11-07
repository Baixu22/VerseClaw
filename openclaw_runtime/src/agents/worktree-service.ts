/**
 * C4 worktree isolation + C4-H production hardening for git worktree lifecycle.
 *
 * Backends:
 * - inprocess (default): directory simulation under `.openclaw/worktrees/<id>`
 * - git: real `git worktree add/remove` when repo is a git work tree; falls back to inprocess
 *
 * Defaults remain isolation=shared and backend=inprocess. C4-H hardens opt-in git path
 * (path normalize, merge lock, cleanup retries, Windows long-path aware roots).
 * C4-P adds opt-in installStrategy (hardlink-modules|pnpm-install); default none.
 * Does NOT flip production defaults.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { withTaskLedgerJournalLockSync } from '../../../shared/task-ledger-journal-lock.js';
import {
  LongSessionCoordinationError,
  decideLongSessionCoordination,
  resolveLongSessionCoordinationPolicy,
} from '../../../shared/long-session-resource-reclamation.js';
import { codingObservability } from '../context-engine/coding-observability.js';
import { assertVerseGitCleanupDeletionAllowed, verseGitCleanupResourceId } from '../../../shared/versegit-cleanup-barrier.js';
import type { VerseGitCleanupDeletionAuthorization } from '../../../shared/types/versegit.js';
import type { WorktreeBackend } from "../context-engine/coding-runtime-flags.js";
import { assertTaskWorktreeReleasable } from '../../../shared/task-system/runtime.js';
import { reviewDiff } from "../context-engine/views/verify/review-diff-view.js";
import type { FactStore } from "../context-engine/factstore/store.js";
import {
  installWorktreeDependencies,
  type WorktreeInstallStrategy,
  type WorktreeInstallResult,
} from "./worktree-pnpm-install.js";

/** C4-H capability: git worktree path is production-hardened while defaults stay safe. */
export const PRODUCTION_GIT_WORKTREE_HARDENED = true as const;
export { PRODUCTION_PNPM_HARDLINK_INSTALL } from "./worktree-pnpm-install.js";
export type { WorktreeInstallStrategy, WorktreeInstallResult } from "./worktree-pnpm-install.js";

export type WorktreeLifecycleOwner = {
  agentId: string;
  sessionKey: string;
  expectedSessionId: string;
  retention?: "keep" | "delete";
};

export type WorktreeLifecycleResult = {
  attempted: number;
  reclaimed: number;
  failed: number;
  kept: number;
  worktreeIds: string[];
  roots: string[];
};

export type WorktreeRecord = {
  id: string;
  generation: string;
  root: string;
  baseRoot: string;
  createdAtMs: number;
  status: "active" | "merged" | "cleaned" | "conflict";
  writeSet?: string[];
  backend: WorktreeBackend;
  gitBranch?: string;
  baseOid?: string;
  owner?: WorktreeLifecycleOwner;
};

export type MergeQueueItem = {
  worktreeId: string;
  changedFiles: string[];
  status: "pending" | "merged" | "conflict" | "rework";
  review?: { relatedTests: string[]; riskLevel: string };
  reason?: string;
};

/** Safe default marks conflict; optional policies return work to worker or escalate lead. */
export type MergeConflictPolicy = "mark_conflict" | "return_worker" | "escalate_lead";

export type WorktreeChangedFiles = {
  files: string[];
  source: "git-status" | "declared-writeSet" | "unavailable";
};

export type WorktreeIsolationInspection =
  | { status: 'verified'; root: string; generation: string; headOid: string; gitDir: string; commonDir: string }
  | { status: 'unverified'; reason: 'missing-worktree' | 'stale-generation' | 'simulated-backend' | 'checkout-mismatch' | 'owner-unavailable' };

export type WorktreeService = {
  backend: WorktreeBackend;
  create(id: string, options?: { writeSet?: string[]; seedFiles?: string[]; installStrategy?: WorktreeInstallStrategy; owner?: WorktreeLifecycleOwner }): WorktreeRecord & { install?: WorktreeInstallResult };
  pathFor(id: string): string;
  list(): WorktreeRecord[];
  inspectIsolation(id: string, generation: string): WorktreeIsolationInspection;
  listChangedFiles(id: string): WorktreeChangedFiles;
  enqueueMerge(item: Omit<MergeQueueItem, "status"> & { status?: MergeQueueItem["status"] }): MergeQueueItem;
  processMergeQueue(
    factStore?: FactStore,
    options?: { conflictPolicy?: MergeConflictPolicy; worktreeIds?: readonly string[] },
  ): MergeQueueItem[];
  cleanup(id: string, options?: { authorization?: VerseGitCleanupDeletionAuthorization }): void;
  listOwned(owner: Pick<WorktreeLifecycleOwner, "sessionKey" | "agentId" | "expectedSessionId">): WorktreeRecord[];
  cleanupOwned(owner: Pick<WorktreeLifecycleOwner, "sessionKey" | "agentId" | "expectedSessionId">): WorktreeLifecycleResult;
  getMergeQueue(): MergeQueueItem[];
};

export type CreateWorktreeServiceOptions = {
  backend?: WorktreeBackend;
  conflictPolicy?: MergeConflictPolicy;
};

const registry = new Map<string, { records: Map<string, WorktreeRecord>; queue: MergeQueueItem[] }>();

function scope(baseRoot: string) {
  const resolved = realpathSync.native(baseRoot);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  let s = registry.get(key);
  if (!s) {
    s = { records: new Map(), queue: [] };
    registry.set(key, s);
  }
  return s;
}

function safeWorktreeId(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "wt";
  if (safeId === '.' || safeId === '..') throw new Error('unsafe_worktree_id');
  return safeId;
}

function pathEntryExists(target: string): boolean {
  try { lstatSync(target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function recordSnapshot(record: WorktreeRecord): WorktreeRecord {
  return { ...record, ...(record.owner ? { owner: { ...record.owner } } : {}),
    ...(record.writeSet ? { writeSet: [...record.writeSet] } : {}) };
}

function canonicalPath(target: string): string {
  const resolved = realpathSync.native(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Normalize relative paths for Windows separators and reject traversal. */
export function normalizeWorktreeRelPath(rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = cleaned.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new Error(`unsafe_worktree_rel_path:${rel}`);
  }
  return parts.join("/");
}

/** Windows long-path aware absolute root when needed. */
export function hardenFsRoot(absPath: string): string {
  const resolved = path.resolve(absPath);
  if (process.platform !== "win32") return resolved;
  if (resolved.startsWith("\\\\?\\")) return resolved;
  if (resolved.length >= 240) {
    return `\\\\?\\${resolved}`;
  }
  return resolved;
}

const GIT_EXEC_TIMEOUT_MS = 15_000;

/** Shared hardened env for all git invocations (C4-H): hooks disabled, no locks, no prompts, fsmonitor off. */
function hardenedGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
  };
}

function listChangedFilesFromGit(root: string): string[] {
  const out = git(
    ["-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all"],
    root,
  );
  const files = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("!!")) continue;
    const raw = line.includes(" -> ") ? line.slice(line.indexOf(" -> ") + 4) : line.slice(3);
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      files.add(normalizeWorktreeRelPath(candidate));
    } catch {
      // Ignore unsafe or malformed status entries.
    }
  }
  return [...files].sort();
}

function isGitRepo(root: string): boolean {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: GIT_EXEC_TIMEOUT_MS,
      env: hardenedGitEnv(),
    }).trim();
    return out === "true";
  } catch {
    return false;
  }
}

/** Hardened git exec for worktree lifecycle (C4-H): hooks disabled, no locks, no stdin, bounded timeout. */
function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: GIT_EXEC_TIMEOUT_MS,
    env: hardenedGitEnv(),
  });
}

function resolveBackend(baseRoot: string, requested: WorktreeBackend): WorktreeBackend {
  if (requested !== "git") return "inprocess";
  return isGitRepo(baseRoot) ? "git" : "inprocess";
}

function sleepMs(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* spin */
  }
}

/** Age never proves a writer has stopped. Reuse the incarnation-aware mutex. */
function withWorktreeLock<T>(baseRoot: string, fn: () => T): T {
  const lockDir = path.join(path.resolve(baseRoot), ".openclaw", "worktrees");
  mkdirSync(lockDir, { recursive: true });
  if (canonicalPath(lockDir) !== (process.platform === 'win32' ? path.resolve(lockDir).toLowerCase() : path.resolve(lockDir))) {
    throw new Error('worktree_root_redirected');
  }
  const lockPath = path.join(lockDir, ".merge.lock");
  if (pathEntryExists(lockPath)) throw new Error('worktree_legacy_lock_unavailable');
  return withTaskLedgerJournalLockSync(lockPath, fn, { timeoutMs: 3000 });
}

function applyConflictPolicy(
  item: MergeQueueItem,
  rec: WorktreeRecord | undefined,
  baseReason: string,
  policy: MergeConflictPolicy,
): void {
  if (policy === "return_worker") {
    item.status = "rework";
    item.reason = `return_worker:${baseReason}`;
  } else if (policy === "escalate_lead") {
    item.status = "conflict";
    item.reason = `escalate_lead:${baseReason}`;
  } else {
    item.status = "conflict";
    item.reason = baseReason;
  }
  if (rec) rec.status = "conflict";
  codingObservability.recordMergeOutcome(true);
}

function seedFilesInto(wtRoot: string, baseRoot: string, seedFiles: string[] | undefined): void {
  for (const relRaw of seedFiles ?? []) {
    const rel = normalizeWorktreeRelPath(relRaw);
    const src = path.join(baseRoot, ...rel.split("/"));
    const dest = path.join(wtRoot, ...rel.split("/"));
    if (existsSync(src) && statSync(src).isFile()) {
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(src, dest);
    }
  }
}

function removePathWithRetries(target: string, attempts = 5): void {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      if (!existsSync(target)) return;
      rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      sleepMs(20 * (i + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'worktree_remove_failed'));
}

function requireCleanupAuthorization(input: {
  rootDir: string;
  baseRoot: string;
  record: WorktreeRecord;
  authorization?: VerseGitCleanupDeletionAuthorization;
  changed: WorktreeChangedFiles;
}): { root: string } {
  const normalizeRoot = (value: string): string => path.resolve(value.replace(/^\\\\\?\\/u, ''));
  const root = normalizeRoot(input.record.root);
  const rootDir = normalizeRoot(input.rootDir);
  const baseRoot = normalizeRoot(input.baseRoot);
  if (root === baseRoot || root === rootDir || !root.startsWith(rootDir + path.sep)) {
    throw new Error('worktree_cleanup_target_not_disposable');
  }
  if (input.record.status === 'cleaned') return { root };
  const allowed = new Set((input.record.writeSet ?? []).map((value) => normalizeWorktreeRelPath(value)));
  const unexpected = input.changed.files.filter((value) => !allowed.has(normalizeWorktreeRelPath(value)));
  if (unexpected.length > 0) {
    throw new Error('worktree_cleanup_user_content_present:' + unexpected.slice(0, 8).join(','));
  }
  const barrierRequired = Boolean(
    process.env.CLAWX_VERSGIT_CLEANUP_ROOT?.trim() || process.env.CLAWX_VERSGIT_BINDING_ENABLED === '1',
  );
  if (barrierRequired) {
    const authorization = input.authorization;
    if (!authorization) throw new Error('worktree_cleanup_barrier_required');
    if (authorization.resourceKind !== 'worktree') throw new Error('worktree_cleanup_barrier_resource_mismatch');
    if (authorization.resourceId !== verseGitCleanupResourceId('worktree', root)) {
      throw new Error('worktree_cleanup_barrier_resource_mismatch');
    }
    if (input.record.baseOid && authorization.expected.baseOid !== input.record.baseOid) {
      throw new Error('worktree_cleanup_barrier_base_mismatch');
    }
    assertVerseGitCleanupDeletionAllowed(authorization);
  }
  return { root };
}
export function createWorktreeService(
  baseRoot: string,
  options?: CreateWorktreeServiceOptions,
): WorktreeService {
  const resolved = realpathSync.native(baseRoot);
  const requested = options?.backend ?? "inprocess";
  const backend = resolveBackend(resolved, requested);
  const defaultConflictPolicy: MergeConflictPolicy = options?.conflictPolicy ?? "mark_conflict";
  const rootDir = path.join(resolved, ".openclaw", "worktrees");

  return {
    backend,
    create(id, createOptions) {
      const s = scope(resolved);
      const owner = createOptions?.owner;
      if (owner) {
        const uniqueRecords = new Set(s.records.values());
        const ownedCount = [...uniqueRecords].filter((record) => (
          record.status !== "cleaned"
          && record.owner?.agentId === owner.agentId
          && record.owner.sessionKey === owner.sessionKey
          && record.owner.expectedSessionId === owner.expectedSessionId
        )).length;
        const budget = decideLongSessionCoordination({
          policy: resolveLongSessionCoordinationPolicy(),
          usage: { processCount: null, rssKb: null, backgroundTerminals: null, worktreeCount: ownedCount },
          request: { worktrees: 1 },
        });
        if (!budget.allowed) throw new LongSessionCoordinationError(budget);
      }
      const safeId = safeWorktreeId(id);
      const writeSet = createOptions?.writeSet?.map(normalizeWorktreeRelPath);
      const seedFiles = createOptions?.seedFiles?.map(normalizeWorktreeRelPath);
      const wtRoot = hardenFsRoot(path.join(rootDir, safeId));
      let recBackend: WorktreeBackend = "inprocess";

      return withWorktreeLock(resolved, () => {
        mkdirSync(rootDir, { recursive: true });
        if (pathEntryExists(wtRoot) || (s.records.has(safeId) && s.records.get(safeId)?.status !== 'cleaned')) {
          throw new Error(`worktree_already_exists:${safeId}`);
        }

        if (backend === "git") {
          // Preserve a failed real checkout for diagnosis. Resetting a branch or
          // falling back to a directory would manufacture an isolation success.
          git(["worktree", "add", "--detach", path.resolve(wtRoot), "HEAD"], resolved);
          recBackend = "git";
        } else {
          mkdirSync(wtRoot, { recursive: true });
          recBackend = "inprocess";
        }

        seedFilesInto(wtRoot, resolved, seedFiles);

        let install: WorktreeInstallResult | undefined;
        if (createOptions?.installStrategy && createOptions.installStrategy !== "none") {
          install = installWorktreeDependencies({
            worktreeRoot: wtRoot,
            baseRoot: resolved,
            strategy: createOptions.installStrategy,
          });
        }

        const rec: WorktreeRecord = {
          id: safeId,
          generation: randomUUID(),
          root: wtRoot,
          baseRoot: resolved,
          createdAtMs: Date.now(),
          status: "active",
          writeSet,
          backend: recBackend,
          ...(recBackend === 'git' ? { baseOid: git(['rev-parse', 'HEAD'], wtRoot).trim() } : {}),
          ...(owner ? { owner: { ...owner, retention: owner.retention ?? "keep" } } : {}),
        };
        s.records.set(safeId, rec);
        if (safeId !== id) s.records.set(id, rec);
        return install ? { ...recordSnapshot(rec), install } : recordSnapshot(rec);
      });
    },
    pathFor(id) {
      const safeId = safeWorktreeId(id);
      return path.join(rootDir, safeId);
    },
    list() {
      const seen = new Set<string>();
      const out: WorktreeRecord[] = [];
      for (const rec of scope(resolved).records.values()) {
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
        out.push(recordSnapshot(rec));
      }
      return out;
    },
    inspectIsolation(id, generation) {
      try {
        return withWorktreeLock(resolved, (): WorktreeIsolationInspection => {
          const rec = scope(resolved).records.get(id);
          if (!rec || rec.status === 'cleaned') return { status: 'unverified', reason: 'missing-worktree' };
          if (rec.generation !== generation) return { status: 'unverified', reason: 'stale-generation' };
          if (rec.backend !== 'git') return { status: 'unverified', reason: 'simulated-backend' };
          const root = canonicalPath(rec.root);
          const expectedRoot = path.resolve(rec.root.replace(/^\\\\\?\\/u, ''));
          if (root !== (process.platform === 'win32' ? expectedRoot.toLowerCase() : expectedRoot)) {
            return { status: 'unverified', reason: 'checkout-mismatch' };
          }
          const topLevel = canonicalPath(git(['rev-parse', '--show-toplevel'], rec.root).trim());
          const gitDir = canonicalPath(git(['rev-parse', '--absolute-git-dir'], rec.root).trim());
          const commonDir = canonicalPath(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], rec.root).trim());
          const baseCommonDir = canonicalPath(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], resolved).trim());
          // The back-pointer binds the private index/HEAD to this checkout. A
          // copied .git file or caller-declared backend cannot establish isolation.
          const registeredRoot = canonicalPath(path.dirname(readFileSync(path.join(gitDir, 'gitdir'), 'utf8').trim()));
          if (root !== topLevel || root !== registeredRoot || commonDir !== baseCommonDir || gitDir === commonDir
            || root === canonicalPath(resolved)) return { status: 'unverified', reason: 'checkout-mismatch' };
          return { status: 'verified', root: rec.root, generation: rec.generation,
            headOid: git(['rev-parse', 'HEAD'], rec.root).trim(), gitDir, commonDir };
        });
      } catch {
        return { status: 'unverified', reason: 'owner-unavailable' };
      }
    },
    listChangedFiles(id) {
      const rec = scope(resolved).records.get(id);
      if (!rec) return { files: [], source: "unavailable" as const };
      if (rec.backend === "git") {
        try {
          return { files: listChangedFilesFromGit(rec.root), source: "git-status" as const };
        } catch {
          return { files: [...(rec.writeSet ?? [])], source: "declared-writeSet" as const };
        }
      }
      return {
        files: [...(rec.writeSet ?? [])],
        source: rec.writeSet?.length ? "declared-writeSet" as const : "unavailable" as const,
      };
    },
    enqueueMerge(item) {
      const s = scope(resolved);
      const entry: MergeQueueItem = {
        worktreeId: item.worktreeId,
        changedFiles: item.changedFiles.map((f) => normalizeWorktreeRelPath(f)),
        status: item.status ?? "pending",
        review: item.review,
        reason: item.reason,
      };
      s.queue.push(entry);
      return entry;
    },
    processMergeQueue(factStore, processOptions) {
      const s = scope(resolved);
      const policy = processOptions?.conflictPolicy ?? defaultConflictPolicy;
      const selectedWorktreeIds = processOptions?.worktreeIds
        ? new Set(processOptions.worktreeIds)
        : undefined;
      const results: MergeQueueItem[] = [];
      withWorktreeLock(resolved, () => {
        for (const item of s.queue) {
          if (selectedWorktreeIds && !selectedWorktreeIds.has(item.worktreeId)) {
            continue;
          }
          if (item.status !== "pending") {
            results.push(item);
            continue;
          }
          const rec = s.records.get(item.worktreeId);
          if (!rec) {
            applyConflictPolicy(item, undefined, "missing_worktree", policy);
            results.push(item);
            continue;
          }
          const conflictWith = results.find(
            (other) =>
              other.status === "merged" &&
              other.changedFiles.some((f) => item.changedFiles.includes(f)),
          );
          if (conflictWith) {
            applyConflictPolicy(item, rec, `overlap_with_${conflictWith.worktreeId}`, policy);
            results.push(item);
            continue;
          }
          let contentConflict = false;
          for (const rel of item.changedFiles) {
            const src = path.join(rec.root, ...rel.split("/"));
            const dest = path.join(resolved, ...rel.split("/"));
            if (existsSync(src) && existsSync(dest)) {
              try {
                const a = readFileSync(src, "utf8");
                const b = readFileSync(dest, "utf8");
                if (
                  a !== b &&
                  results.some((r) => r.status === "merged" && r.changedFiles.includes(rel))
                ) {
                  applyConflictPolicy(item, rec, `content_conflict_${rel}`, policy);
                  contentConflict = true;
                  break;
                }
              } catch {
                // ignore read errors
              }
            }
          }
          if (contentConflict) {
            results.push(item);
            continue;
          }
          if (factStore) {
            try {
              const review = reviewDiff(factStore, resolved, { changedFiles: item.changedFiles });
              item.review = {
                relatedTests: review.relatedTests ?? [],
                riskLevel: review.riskLevel,
              };
            } catch {
              // fail-open review
            }
          }
          for (const rel of item.changedFiles) {
            const src = path.join(rec.root, ...rel.split("/"));
            const dest = path.join(resolved, ...rel.split("/"));
            if (existsSync(src)) {
              mkdirSync(path.dirname(dest), { recursive: true });
              cpSync(src, dest);
            }
          }
          item.status = "merged";
          rec.status = "merged";
          codingObservability.recordMergeOutcome(false);
          results.push(item);
        }
        s.queue = results.filter((r) => r.status === "pending");
      });
      return results;
    },
    cleanup(id, cleanupOptions) {
      const s = scope(resolved);
      const rec = s.records.get(id);
      if (!rec) return;
      assertTaskWorktreeReleasable(rec.root);
      withWorktreeLock(resolved, () => {
        const ownership = requireCleanupAuthorization({
          rootDir,
          baseRoot: resolved,
          record: rec,
          authorization: cleanupOptions?.authorization,
          changed: this.listChangedFiles(id),
        });
        if (rec.backend === "git") {
          try {
            git(["worktree", "remove", "--force", ownership.root], resolved);
          } catch (error) {
            try {
              removePathWithRetries(ownership.root);
            } catch {
              throw error;
            }
            try {
              git(["worktree", "prune"], resolved);
            } catch {
              // ignore
            }
          }
        } else {
          removePathWithRetries(ownership.root);
        }
        if (existsSync(ownership.root)) {
          throw new Error('worktree_cleanup_survivor');
        }
        rec.status = "cleaned";
      });
    },
    listOwned(owner) {
      const uniqueRecords = new Set(scope(resolved).records.values());
      return [...uniqueRecords].filter((record) => (
        record.status !== "cleaned"
        && record.owner?.agentId === owner.agentId
        && record.owner.sessionKey === owner.sessionKey
        && record.owner.expectedSessionId === owner.expectedSessionId
      )).map(recordSnapshot);
    },
    cleanupOwned(owner) {
      const uniqueRecords = new Set(scope(resolved).records.values());
      const owned = [...uniqueRecords].filter((record) => (
        record.status !== "cleaned"
        && record.owner?.agentId === owner.agentId
        && record.owner.sessionKey === owner.sessionKey
        && record.owner.expectedSessionId === owner.expectedSessionId
      ));
      let reclaimed = 0;
      let kept = 0;
      let failed = 0;
      const worktreeIds = [];
      const roots = [];
      for (const record of owned) {
        if (record.owner?.retention === "keep") {
          kept += 1;
          continue;
        }
        try {
          this.cleanup(record.id);
          reclaimed += 1;
          worktreeIds.push(record.id);
          roots.push(record.root);
        } catch {
          failed += 1;
        }
      }
      return { attempted: owned.length, reclaimed, failed, kept, worktreeIds, roots };
    },
    getMergeQueue() {
      return [...scope(resolved).queue];
    },
  };
}

export function __resetWorktreeRegistry(): void {
  registry.clear();
}

/** Test helper: list orphan directory names under .openclaw/worktrees */
export function listWorktreeDirs(baseRoot: string): string[] {
  const dir = path.join(path.resolve(baseRoot), ".openclaw", "worktrees");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !name.startsWith("."));
}

/** Ensure parent dirs exist before writing a relative path under a worktree root. */
export function writeWorktreeFile(worktreeRoot: string, relativePath: string, content: string): void {
  const rel = normalizeWorktreeRelPath(relativePath);
  const dest = path.join(worktreeRoot, ...rel.split("/"));
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf8");
}
