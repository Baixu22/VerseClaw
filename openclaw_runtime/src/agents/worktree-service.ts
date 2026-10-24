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
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  LongSessionCoordinationError,
  decideLongSessionCoordination,
  resolveLongSessionCoordinationPolicy,
} from "../../../shared/long-session-resource-reclamation.js";
import { codingObservability } from "../context-engine/coding-observability.js";
import type { WorktreeBackend } from "../context-engine/coding-runtime-flags.js";
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

export type WorktreeRecord = {
  id: string;
  root: string;
  baseRoot: string;
  createdAtMs: number;
  status: "active" | "merged" | "cleaned" | "conflict";
  writeSet?: string[];
  backend: WorktreeBackend;
  gitBranch?: string;
  owner?: WorktreeLifecycleOwner;
};

export type WorktreeLifecycleResult = {
  attempted: number;
  reclaimed: number;
  failed: number;
  kept: number;
  worktreeIds: string[];
  roots: string[];
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

export type WorktreeService = {
  backend: WorktreeBackend;
  create(id: string, options?: { writeSet?: string[]; seedFiles?: string[]; installStrategy?: WorktreeInstallStrategy; owner?: WorktreeLifecycleOwner }): WorktreeRecord & { install?: WorktreeInstallResult };
  pathFor(id: string): string;
  list(): WorktreeRecord[];
  listChangedFiles(id: string): WorktreeChangedFiles;
  enqueueMerge(item: Omit<MergeQueueItem, "status"> & { status?: MergeQueueItem["status"] }): MergeQueueItem;
  processMergeQueue(
    factStore?: FactStore,
    options?: { conflictPolicy?: MergeConflictPolicy; worktreeIds?: readonly string[] },
  ): MergeQueueItem[];
  cleanup(id: string): void;
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
  const key = path.resolve(baseRoot);
  let s = registry.get(key);
  if (!s) {
    s = { records: new Map(), queue: [] };
    registry.set(key, s);
  }
  return s;
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

/** Exclusive create lock with stale recovery (C4-H merge/cleanup serialization). */
function withWorktreeLock(baseRoot: string, fn: () => void): void {
  const lockDir = path.join(path.resolve(baseRoot), ".openclaw", "worktrees");
  mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, ".merge.lock");
  const started = Date.now();
  let fd: number | undefined;
  while (Date.now() - started < 3000) {
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`, "utf8");
      break;
    } catch {
      try {
        if (existsSync(lockPath)) {
          const raw = readFileSync(lockPath, "utf8");
          const ts = Number(raw.split(/\r?\n/)[1] ?? 0);
          if (ts > 0 && Date.now() - ts > 10_000) {
            unlinkSync(lockPath);
            continue;
          }
        }
      } catch {
        // ignore
      }
      sleepMs(10);
    }
  }
  try {
    fn();
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // ignore
      }
    }
  }
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
  for (let i = 0; i < attempts; i++) {
    try {
      if (!existsSync(target)) return;
      rmSync(target, { recursive: true, force: true });
      return;
    } catch {
      sleepMs(20 * (i + 1));
    }
  }
}

export function createWorktreeService(
  baseRoot: string,
  options?: CreateWorktreeServiceOptions,
): WorktreeService {
  const resolved = path.resolve(baseRoot);
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
          usage: {
            processCount: null,
            rssKb: null,
            backgroundTerminals: null,
            worktreeCount: ownedCount,
          },
          request: { worktrees: 1 },
        });
        if (!budget.allowed) throw new LongSessionCoordinationError(budget);
      }
      const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "wt";
      const wtRoot = hardenFsRoot(path.join(rootDir, safeId));
      let gitBranch: string | undefined;
      let recBackend: WorktreeBackend = "inprocess";

      withWorktreeLock(resolved, () => {
        mkdirSync(rootDir, { recursive: true });
        if (existsSync(wtRoot)) {
          removePathWithRetries(wtRoot);
        }

        if (backend === "git") {
          gitBranch = `openclaw/wt-${safeId.slice(0, 40)}`;
          const absWt = path.resolve(wtRoot);
          try {
            git(["worktree", "add", "--detach", absWt, "HEAD"], resolved);
            recBackend = "git";
          } catch {
            try {
              git(["worktree", "add", "-B", gitBranch, absWt, "HEAD"], resolved);
              recBackend = "git";
            } catch {
              mkdirSync(wtRoot, { recursive: true });
              gitBranch = undefined;
              recBackend = "inprocess";
            }
          }
        } else {
          mkdirSync(wtRoot, { recursive: true });
          recBackend = "inprocess";
        }

        seedFilesInto(wtRoot, resolved, createOptions?.seedFiles);
      });

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
        root: wtRoot,
        baseRoot: resolved,
        createdAtMs: Date.now(),
        status: "active",
        writeSet: createOptions?.writeSet?.map((p) => normalizeWorktreeRelPath(p)),
        backend: recBackend,
        gitBranch,
        ...(owner
          ? {
              owner: {
                ...owner,
                retention: owner.retention ?? "keep",
              },
            }
          : {}),
      };
      s.records.set(safeId, rec);
      if (safeId !== id) s.records.set(id, rec);
      return install ? { ...rec, install } : rec;
    },
    pathFor(id) {
      const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "wt";
      return path.join(rootDir, safeId);
    },
    list() {
      const seen = new Set<string>();
      const out: WorktreeRecord[] = [];
      for (const rec of scope(resolved).records.values()) {
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
        out.push(rec);
      }
      return out;
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
    cleanup(id) {
      const s = scope(resolved);
      const rec = s.records.get(id);
      if (!rec) return;
      withWorktreeLock(resolved, () => {
        if (rec.backend === "git") {
          try {
            git(["worktree", "remove", "--force", path.resolve(rec.root)], resolved);
          } catch {
            removePathWithRetries(rec.root);
            try {
              git(["worktree", "prune"], resolved);
            } catch {
              // ignore
            }
          }
        } else {
          removePathWithRetries(rec.root);
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
      ));
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
      let failed = 0;
      let kept = 0;
      const worktreeIds: string[] = [];
      const roots: string[] = [];
      for (const record of owned) {
        worktreeIds.push(record.id);
        roots.push(record.root);
        if (record.status === "cleaned") {
          reclaimed += 1;
          continue;
        }
        if (record.owner?.retention !== "delete") {
          kept += 1;
          continue;
        }
        try {
          this.cleanup(record.id);
          if (existsSync(record.root)) failed += 1;
          else reclaimed += 1;
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
