/**
 * C4 / C4-H: worktree isolation primitives create/merge/cleanup + merge queue.
 *
 * Backends:
 * - inprocess (default): directory simulation under `.openclaw/worktrees/<id>`
 * - git: real `git worktree add/remove` when repo is a git work tree; falls back to inprocess
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { codingObservability } from "../context-engine/coding-observability.js";
import type { WorktreeBackend } from "../context-engine/coding-runtime-flags.js";
import { reviewDiff } from "../context-engine/views/verify/review-diff-view.js";
import type { FactStore } from "../context-engine/factstore/store.js";

export type WorktreeRecord = {
  id: string;
  root: string;
  baseRoot: string;
  createdAtMs: number;
  status: "active" | "merged" | "cleaned" | "conflict";
  writeSet?: string[];
  backend: WorktreeBackend;
  gitBranch?: string;
};

export type MergeQueueItem = {
  worktreeId: string;
  changedFiles: string[];
  status: "pending" | "merged" | "conflict" | "rework";
  review?: { relatedTests: string[]; riskLevel: string };
  reason?: string;
};

export type WorktreeService = {
  backend: WorktreeBackend;
  create(id: string, options?: { writeSet?: string[]; seedFiles?: string[] }): WorktreeRecord;
  pathFor(id: string): string;
  list(): WorktreeRecord[];
  enqueueMerge(item: Omit<MergeQueueItem, "status"> & { status?: MergeQueueItem["status"] }): MergeQueueItem;
  processMergeQueue(factStore?: FactStore): MergeQueueItem[];
  cleanup(id: string): void;
  getMergeQueue(): MergeQueueItem[];
};

export type CreateWorktreeServiceOptions = {
  backend?: WorktreeBackend;
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

function isGitRepo(root: string): boolean {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "true";
  } catch {
    return false;
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveBackend(baseRoot: string, requested: WorktreeBackend): WorktreeBackend {
  if (requested !== "git") return "inprocess";
  return isGitRepo(baseRoot) ? "git" : "inprocess";
}

export function createWorktreeService(
  baseRoot: string,
  options?: CreateWorktreeServiceOptions,
): WorktreeService {
  const resolved = path.resolve(baseRoot);
  const requested = options?.backend ?? "inprocess";
  const backend = resolveBackend(resolved, requested);
  const rootDir = path.join(resolved, ".openclaw", "worktrees");

  return {
    backend,
    create(id, createOptions) {
      const s = scope(resolved);
      const wtRoot = path.join(rootDir, id);
      let gitBranch: string | undefined;

      if (backend === "git") {
        mkdirSync(rootDir, { recursive: true });
        if (existsSync(wtRoot)) {
          try {
            rmSync(wtRoot, { recursive: true, force: true });
          } catch {
            // continue; git worktree add will fail loudly if needed
          }
        }
        gitBranch = `openclaw/wt-${id.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40)}`;
        try {
          // Prefer detached worktree from HEAD for isolation.
          git(["worktree", "add", "--detach", wtRoot, "HEAD"], resolved);
        } catch {
          // Fallback: branch-based worktree
          try {
            git(["worktree", "add", "-B", gitBranch, wtRoot, "HEAD"], resolved);
          } catch {
            // Ultimate fallback: inprocess tree for this id
            mkdirSync(wtRoot, { recursive: true });
            gitBranch = undefined;
          }
        }
        for (const rel of createOptions?.seedFiles ?? []) {
          const src = path.join(resolved, rel);
          const dest = path.join(wtRoot, rel);
          if (existsSync(src) && statSync(src).isFile()) {
            mkdirSync(path.dirname(dest), { recursive: true });
            cpSync(src, dest);
          }
        }
      } else {
        mkdirSync(wtRoot, { recursive: true });
        for (const rel of createOptions?.seedFiles ?? []) {
          const src = path.join(resolved, rel);
          const dest = path.join(wtRoot, rel);
          if (existsSync(src) && statSync(src).isFile()) {
            mkdirSync(path.dirname(dest), { recursive: true });
            cpSync(src, dest);
          }
        }
      }

      const rec: WorktreeRecord = {
        id,
        root: wtRoot,
        baseRoot: resolved,
        createdAtMs: Date.now(),
        status: "active",
        writeSet: createOptions?.writeSet,
        backend: existsSync(path.join(wtRoot, ".git")) || backend === "git" ? backend : "inprocess",
        gitBranch,
      };
      // If git worktree created, .git is a file pointer; treat requested backend as authoritative when tree exists.
      if (backend === "git" && existsSync(wtRoot)) {
        rec.backend = "git";
      }
      s.records.set(id, rec);
      return rec;
    },
    pathFor(id) {
      return path.join(rootDir, id);
    },
    list() {
      return [...scope(resolved).records.values()];
    },
    enqueueMerge(item) {
      const s = scope(resolved);
      const entry: MergeQueueItem = {
        worktreeId: item.worktreeId,
        changedFiles: item.changedFiles,
        status: item.status ?? "pending",
        review: item.review,
        reason: item.reason,
      };
      s.queue.push(entry);
      return entry;
    },
    processMergeQueue(factStore) {
      const s = scope(resolved);
      const results: MergeQueueItem[] = [];
      // Serial merge
      for (const item of s.queue) {
        if (item.status !== "pending") {
          results.push(item);
          continue;
        }
        const rec = s.records.get(item.worktreeId);
        if (!rec) {
          item.status = "conflict";
          item.reason = "missing_worktree";
          codingObservability.recordMergeOutcome(true);
          results.push(item);
          continue;
        }
        // Conflict if another active worktree claims overlapping changed files already merged
        const conflictWith = results.find(
          (other) =>
            other.status === "merged" &&
            other.changedFiles.some((f) => item.changedFiles.includes(f)),
        );
        if (conflictWith) {
          item.status = "conflict";
          item.reason = `overlap_with_${conflictWith.worktreeId}`;
          rec.status = "conflict";
          codingObservability.recordMergeOutcome(true);
          results.push(item);
          continue;
        }
        // Content-level conflict: if base file differs from worktree and was also changed by another merge path
        for (const rel of item.changedFiles) {
          const src = path.join(rec.root, rel);
          const dest = path.join(resolved, rel);
          if (existsSync(src) && existsSync(dest)) {
            try {
              const a = readFileSync(src, "utf8");
              const b = readFileSync(dest, "utf8");
              // soft signal only; hard conflict already covered by overlap
              if (a !== b && results.some((r) => r.status === "merged" && r.changedFiles.includes(rel))) {
                item.status = "conflict";
                item.reason = `content_conflict_${rel}`;
                rec.status = "conflict";
                codingObservability.recordMergeOutcome(true);
                break;
              }
            } catch {
              // ignore
            }
          }
        }
        if (item.status === "conflict") {
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
        // Copy worktree files into base (works for both backends)
        for (const rel of item.changedFiles) {
          const src = path.join(rec.root, rel);
          const dest = path.join(resolved, rel);
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
      return results;
    },
    cleanup(id) {
      const s = scope(resolved);
      const rec = s.records.get(id);
      if (!rec) return;
      if (rec.backend === "git") {
        try {
          git(["worktree", "remove", "--force", rec.root], resolved);
        } catch {
          try {
            rmSync(rec.root, { recursive: true, force: true });
            try {
              git(["worktree", "prune"], resolved);
            } catch {
              // ignore
            }
          } catch {
            // ignore
          }
        }
      } else {
        try {
          rmSync(rec.root, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
      rec.status = "cleaned";
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
  return readdirSync(dir);
}