/**
 * P5 UFTK: git-backed workspace checkpoint. P6B: path-scoped scope, checkpoint
 * metadata (label/scope/parent), and main-repository worktree support.
 *
 * Checkpoint creation uses the same technique as `git stash create`: a
 * temporary index (`GIT_INDEX_FILE`), `git add -A` into that temp index,
 * `git write-tree`, `git commit-tree`, and a private ref under
 * `refs/openclaw/uftk-checkpoints/<id>`. The real index and worktree are not
 * modified by checkpoint creation. A path-scoped checkpoint stages only the
 * requested paths into that temp index, so its tree contains exactly the scope
 * and both create and restore cost scale with the scope, not the repository.
 *
 * Restore never uses `git reset --hard` or `git clean -f`. It materializes the
 * checkpoint tree through a temp index + `git checkout-index`, then removes
 * only the pre-restore paths that are absent from the checkpoint tree
 * (excluding `.git`, `.openclaw`, and lock sidecars). A scoped restore confines
 * both the checkout and the removal sweep to the scope, leaving out-of-scope
 * worktree and index state byte-identical. Restores are serialized per
 * workspace through a process-local queue and the existing session-write-lock
 * protocol (its lock file lives under the OpenClaw state dir, not the
 * workspace); with P6A `concurrencyV2` enabled they additionally hold the
 * workspace restore barrier so UFTK writers are excluded.
 *
 * git checkpoints never replace write-journal rollback; the two paths stay
 * separate and this module does not import the journal or FTS rollback.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveStateDir } from "../../config/paths.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { acquireSessionWriteLock } from "../session-write-lock.js";
import { CodingRuntimeError } from "./coding-runtime-error.js";
import { acquireWorkspaceRestoreBarrier } from "./file-lock-manager.js";

const execFileAsync = promisify(execFile);

export const GIT_CHECKPOINT_REF_PREFIX = "refs/openclaw/uftk-checkpoints";

/**
 * P7 (carry-over A): private namespace for pre-restore safety checkpoints.
 *
 * Safety refs deliberately live *outside* `GIT_CHECKPOINT_REF_PREFIX` so the
 * lifecycle retention/prune surface — which enumerates only the checkpoint
 * prefix — cannot delete the one ref holding a user's pre-restore content. P7's
 * auto-checkpoint creates checkpoints in bulk and reuses that retention, which
 * is exactly the pressure that would otherwise reap safety refs.
 */
export const GIT_CHECKPOINT_SAFETY_REF_PREFIX = "refs/openclaw/uftk-safety";

/** Metadata schema version written into the checkpoint commit message trailers. */
export const GIT_CHECKPOINT_METADATA_VERSION = 2;

/**
 * P6B checkpoint scope. `full` reproduces the accepted P5 whole-tree semantics;
 * `paths` records the exact normalized path set the checkpoint covers.
 */
export type GitCheckpointScope = {
  kind: "full" | "paths";
  /** POSIX-relative, deduped, sorted. Empty for `full`. */
  paths: readonly string[];
};

export const FULL_CHECKPOINT_SCOPE: GitCheckpointScope = { kind: "full", paths: [] };

export type GitCheckpointRecord = {
  id: string;
  commit: string;
  ref: string;
  createdAt: string;
  /**
   * Millisecond-resolution creation time used for ordering.
   *
   * git's `creatordate` only has second resolution, so checkpoints created
   * inside the same second sort ambiguously -- and "the newest checkpoint is
   * always protected" is only as strong as that ordering. P7's auto-checkpoint
   * creates checkpoints in bursts, which makes same-second collisions ordinary
   * rather than theoretical, so ordering falls back on the millisecond timestamp
   * already embedded in the checkpoint commit subject. P5 checkpoints without one
   * degrade to the parsed `creatordate`.
   */
  createdAtMs: number;
  workspaceRoot: string;
  /** P6B: scope recorded at creation. P5 checkpoints resolve to `full`. */
  scope?: GitCheckpointScope;
  /** P6B: caller-supplied label (sanitized). Absent when unlabeled. */
  label?: string;
  /** P6B: parent commit of the checkpoint commit, when the repo had a HEAD. */
  parent?: string;
};

export type GitCheckpointCreateStatus =
  | "created"
  | "disabled"
  | "unsupported"
  | "failed";

export type GitCheckpointCreateResult = {
  status: GitCheckpointCreateStatus;
  checkpoint?: GitCheckpointRecord;
  reason?: string;
  error?: {
    code: string;
    message: string;
  };
  /** True when the real git index and worktree status were byte-identical before/after creation. */
  indexWorktreeUnchanged?: boolean;
  /**
   * P6B: nested `.git` subtrees that exist in the workspace but outside the
   * requested scope. They are explicitly skipped (never silently half-included)
   * and each one is also reported through `warn`.
   */
  skippedNestedRepos?: string[];
};

export type GitCheckpointRestoreStatus =
  | "restored"
  | "disabled"
  | "unsupported"
  | "not_found"
  | "conflict"
  | "failed"
  /** P6B: apply phase failed after mutating the worktree; recover from recoveryRef/safetyRef. */
  | "recovery_required";

export type GitCheckpointRestoreResult = {
  status: GitCheckpointRestoreStatus;
  checkpointId: string;
  reason?: string;
  error?: {
    code: string;
    message: string;
  };
  diagnostic?: {
    beforeStatus: string;
    beforeTracked: string[];
    beforeUntracked: string[];
    targetPaths: string[];
    /** P6B: effective scope of this restore. */
    scope?: GitCheckpointScope;
    /** P6B: in-scope paths removed because they are absent from the checkpoint tree. */
    removedPaths?: string[];
    /** P6B: nested `.git` subtrees skipped outside the requested scope. */
    skippedNestedRepos?: string[];
  };
  /** P6B: safety checkpoint ref covering the pre-restore state of affected paths. */
  safetyRef?: string;
  /** P6B: raw byte backup directory for at-risk files, when one was written. */
  recoveryRef?: string;
};

export type GitCheckpointListStatus = "ok" | "disabled" | "unsupported";

export type GitCheckpointListResult = {
  status: GitCheckpointListStatus;
  checkpoints: GitCheckpointRecord[];
  reason?: string;
};

export type GitCheckpointServiceOptions = {
  workspaceRoot: string;
  /** P5 flag. Default false; the production tool surface does not wire this service. */
  enabled?: boolean;
  /** P6B flag `runtime.coding.uftk.gitCheckpoint.pathScoped.enabled`. Default false. */
  pathScopedEnabled?: boolean;
  /**
   * P6A flag `runtime.coding.uftk.concurrencyV2.enabled`. Default false. When
   * enabled, restore additionally holds the workspace restore barrier so UFTK
   * write prepares are excluded for the duration; when disabled the lock
   * behavior is byte-identical to the accepted P5 path.
   */
  concurrencyV2Enabled?: boolean;
  /** State/log directory for temp indexes and the cross-process restore lock. */
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  gitTimeoutMs?: number;
  restoreLockTimeoutMs?: number;
  warn?: (message: string) => void;
};

type GitEnv = NodeJS.ProcessEnv & { GIT_INDEX_FILE: string };

function normalizeWorkspaceRoot(root: string): string {
  return path.resolve(root);
}

function gitErrorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function gitErrorMessage(error: unknown): string {
  const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const detail =
    typeof record.stderr === "string" && record.stderr.trim()
      ? record.stderr.trim()
      : typeof record.message === "string"
        ? record.message
        : String(error);
  return detail;
}

function checkpointError(
  code:
    | "E_GIT_CHECKPOINT_DISABLED"
    | "E_GIT_CHECKPOINT_UNSUPPORTED"
    | "E_GIT_CHECKPOINT_NOT_FOUND"
    | "E_GIT_CHECKPOINT_CONFLICT"
    | "E_GIT_CHECKPOINT_TIMEOUT"
    | "E_GIT_CHECKPOINT_FAILED"
    | "E_GIT_CHECKPOINT_RECOVERY_REQUIRED",
  message: string,
): CodingRuntimeError {
  return new CodingRuntimeError({ code, message });
}

function safeJoinRoot(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (resolved !== path.resolve(root) && !resolved.startsWith(prefix)) {
    throw checkpointError("E_GIT_CHECKPOINT_FAILED", `Path escapes workspace: ${relPath}`);
  }
  return resolved;
}

/**
 * Join a workspace-relative checkpoint path, rejecting escapes. Shared with the
 * P6B safety and transaction modules so every path they touch is bounded by the
 * same check.
 */
export const safeJoinCheckpointRoot = safeJoinRoot;

function isInternalRestorePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  if (normalized.startsWith(".openclaw/")) return true;
  const lower = normalized.toLowerCase();
  return lower.endsWith(".lock") || normalized.includes(".uftk-") || normalized.includes(".lock-target");
}

function workspaceLockKey(root: string, env: NodeJS.ProcessEnv): string {
  const digest = createHash("sha256")
    .update(path.resolve(root).toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return path.join(resolveStateDir(env), "locks", `uftk-git-checkpoint-${digest}.lock-target`);
}

const restoreQueues = new Map<string, Promise<unknown>>();

/**
 * Acquire only the cross-process restore lock for a workspace, in acquire/release
 * form for the P6B two-phase transaction. The transaction already serializes
 * in-process through the P6A workspace barrier, so it does not need the
 * process-local queue that `withRestoreLock` adds.
 *
 * Callers must acquire the workspace barrier *before* this lock, matching the
 * order used by `GitCheckpointService.restoreCheckpoint`, so the two restore
 * paths can never deadlock against each other.
 */
export async function acquireCheckpointRestoreLock(params: {
  root: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<{ release: () => Promise<void> }> {
  const lock = await acquireSessionWriteLock({
    sessionFile: workspaceLockKey(params.root, params.env),
    timeoutMs: params.timeoutMs,
  });
  return {
    release: async () => {
      await lock.release().catch(() => undefined);
    },
  };
}

async function withRestoreLock<T>(params: {
  key: string;
  sessionFile: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  fn: () => Promise<T>;
}): Promise<T> {
  const previous = restoreQueues.get(params.key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const lock = await acquireSessionWriteLock({
        sessionFile: params.sessionFile,
        timeoutMs: params.timeoutMs,
      });
      try {
        return await params.fn();
      } finally {
        await lock.release().catch(() => undefined);
      }
    });
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  restoreQueues.set(params.key, settled);
  try {
    return await run;
  } finally {
    if (restoreQueues.get(params.key) === settled) {
      restoreQueues.delete(params.key);
    }
  }
}

function splitNullSeparated(value: string): string[] {
  return value.split("\0").filter((item) => item.length > 0);
}

/** Split NUL-separated git output. Shared with the P6B transaction module. */
export const splitCheckpointNullSeparated = splitNullSeparated;

function splitLines(value: string): string[] {
  return value
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const CHECKPOINT_RECORD_SEPARATOR = "\u0001";
const CHECKPOINT_FIELD_SEPARATOR = "\u0000";

/**
 * Read every checkpoint ref with its scope/label/parent metadata.
 *
 * NUL-separated fields plus a record terminator keep multi-line commit bodies
 * from corrupting the parse. `refPrefix` selects the namespace: the default
 * checkpoint prefix, or `GIT_CHECKPOINT_SAFETY_REF_PREFIX` for safety refs. The
 * two namespaces are siblings, so enumerating one never returns the other.
 */
export async function readCheckpointRecords(params: {
  root: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  refPrefix?: string;
}): Promise<GitCheckpointRecord[]> {
  const refPrefix = params.refPrefix ?? GIT_CHECKPOINT_REF_PREFIX;
  const raw = await runGit({
    args: [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(creatordate:iso8601)%00%(parent)%00%(contents)%01",
      refPrefix,
    ],
    cwd: params.root,
    env: params.env,
    timeoutMs: params.timeoutMs,
  });
  const records: GitCheckpointRecord[] = [];
  for (const chunk of raw.split(CHECKPOINT_RECORD_SEPARATOR)) {
    const trimmed = chunk.replace(/^[\r\n]+/, "");
    if (!trimmed.trim()) continue;
    const fields = trimmed.split(CHECKPOINT_FIELD_SEPARATOR);
    const ref = fields[0]?.trim();
    const commit = fields[1]?.trim();
    const createdAt = fields[2]?.trim();
    const parents = fields[3]?.trim() ?? "";
    const contents = fields[4] ?? "";
    if (!ref || !commit || !createdAt) continue;
    const metadata = decodeCheckpointMetadata(contents);
    const parent = parents.split(/\s+/).filter(Boolean)[0];
    const gitCreatedAtMs = Date.parse(createdAt);
    records.push({
      id: ref.slice(ref.lastIndexOf("/") + 1),
      commit,
      ref,
      createdAt,
      createdAtMs:
        metadata.createdAtMs ?? (Number.isFinite(gitCreatedAtMs) ? gitCreatedAtMs : 0),
      workspaceRoot: path.resolve(params.root),
      scope: metadata.scope,
      ...(metadata.label ? { label: metadata.label } : {}),
      ...(parent ? { parent } : {}),
    });
  }
  return records;
}

async function scanNestedGitMarkers(root: string): Promise<string[]> {
  const markers: string[] = [];
  const skipped = new Set(["node_modules", ".openclaw", ".venv", "venv", "__pycache__", "coverage", ".next"]);

  async function walk(dirAbs: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".git" && path.resolve(dirAbs) !== path.resolve(root)) {
        markers.push(path.relative(root, path.join(dirAbs, entry.name)).split(path.sep).join("/"));
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git" || skipped.has(entry.name)) continue;
      await walk(path.join(dirAbs, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return markers;
}

async function runGit(params: {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", params.args, {
      cwd: params.cwd,
      env: params.env ?? process.env,
      timeout: params.timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (caught) {
    const code = gitErrorCode(caught);
    const killed = (caught as { killed?: unknown } | null)?.killed === true;
    if (code === "ETIMEDOUT" || code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || killed) {
      throw checkpointError("E_GIT_CHECKPOINT_TIMEOUT", gitErrorMessage(caught));
    }
    throw checkpointError("E_GIT_CHECKPOINT_FAILED", gitErrorMessage(caught));
  }
}

/**
 * Run a git command inside the checkpoint workspace with the shared timeout and
 * structured-error contract. Shared with the P6B safety, transaction, and
 * lifecycle modules so there is one git invocation path.
 */
export const runGitCheckpointCommand = runGit;

/**
 * P6B: resolved git layout for the workspace root.
 *
 * `plain` is a normal repository whose `.git` is a directory. `linked-worktree`
 * is a main-repository worktree whose `.git` is a file pointing into
 * `<common>/worktrees/<name>`; it is supported because `--git-common-dir`
 * resolves back to the main repository. Submodules are deliberately NOT a kind
 * here: they resolve to `unsupported` with an explicit warning.
 */
export type GitCheckpointLayout = {
  root: string;
  gitDir: string;
  gitCommonDir: string;
  kind: "plain" | "linked-worktree";
  /** Nested `.git` markers found in the workspace (POSIX-relative). */
  nestedRepos: string[];
};

type GitContextResolution =
  | { ok: true; layout: GitCheckpointLayout }
  | { ok: false; reason: string; code: string };

async function resolveGitCheckpointContext(params: {
  root: string;
  enabled: boolean;
  warn: (message: string) => void;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}): Promise<GitContextResolution> {
  if (!params.enabled) {
    return { ok: false, reason: "git checkpoint is disabled", code: "E_GIT_CHECKPOINT_DISABLED" };
  }
  try {
    await runGit({
      args: ["rev-parse", "--is-inside-work-tree"],
      cwd: params.root,
      env: params.env,
      timeoutMs: params.timeoutMs,
    });
  } catch {
    return { ok: false, reason: "not a git work tree", code: "E_GIT_CHECKPOINT_UNSUPPORTED" };
  }

  let rootGitStat;
  try {
    rootGitStat = await fs.stat(path.join(params.root, ".git"));
  } catch {
    return { ok: false, reason: "missing .git", code: "E_GIT_CHECKPOINT_UNSUPPORTED" };
  }

  const resolveDir = async (flag: "--git-dir" | "--git-common-dir"): Promise<string> => {
    const raw = (
      await runGit({
        args: ["rev-parse", flag],
        cwd: params.root,
        env: params.env,
        timeoutMs: params.timeoutMs,
      })
    ).trim();
    return path.resolve(params.root, raw);
  };

  let gitDir: string;
  let gitCommonDir: string;
  try {
    gitDir = await resolveDir("--git-dir");
    gitCommonDir = await resolveDir("--git-common-dir");
  } catch {
    return {
      ok: false,
      reason: "unable to resolve git dir layout",
      code: "E_GIT_CHECKPOINT_UNSUPPORTED",
    };
  }

  let kind: GitCheckpointLayout["kind"] = "plain";
  if (rootGitStat.isFile()) {
    // A linked worktree has a private git dir under the main repo's common dir.
    // A submodule's git dir *is* its common dir (under `<parent>/modules/...`).
    if (gitDir !== gitCommonDir) {
      kind = "linked-worktree";
    } else {
      const normalized = gitCommonDir.replace(/\\/g, "/");
      const detail = normalized.includes("/modules/")
        ? "submodule .git link is unsupported"
        : "unrecognized .git link is unsupported";
      params.warn(`coding-git-checkpoint: workspace .git is a link (${normalized}); ${detail}`);
      return { ok: false, reason: detail, code: "E_GIT_CHECKPOINT_UNSUPPORTED" };
    }
  }

  const nestedRepos = await scanNestedGitMarkers(params.root);
  return {
    ok: true,
    layout: {
      root: path.resolve(params.root),
      gitDir,
      gitCommonDir,
      kind,
      nestedRepos,
    },
  };
}

/**
 * Decide how nested `.git` subtrees interact with the requested scope.
 *
 * Whole-tree operations keep the accepted P5 behavior: any nested repository
 * makes the operation `unsupported`. Path-scoped operations are supported when
 * no nested repository falls inside the scope; the out-of-scope ones are
 * reported as explicitly skipped (never silently half-included).
 */
function resolveNestedRepoPolicy(params: {
  nestedRepos: readonly string[];
  scope: GitCheckpointScope;
  warn: (message: string) => void;
  operation: string;
}): { ok: true; skipped: string[] } | { ok: false; reason: string } {
  if (params.nestedRepos.length === 0) return { ok: true, skipped: [] };
  if (params.scope.kind === "full") {
    const detail = `nested .git/submodule paths are unsupported: ${params.nestedRepos.slice(0, 3).join(", ")}`;
    params.warn(
      `coding-git-checkpoint: nested .git detected at ${params.nestedRepos.slice(0, 3).join(", ")}; unsupported`,
    );
    return { ok: false, reason: detail };
  }
  const inScope = params.nestedRepos.filter((marker) => {
    const owner = marker.replace(/\/?\.git$/, "");
    return params.scope.paths.some(
      (entry) => isPathUnderScopeEntry(owner, entry) || isPathUnderScopeEntry(entry, owner),
    );
  });
  if (inScope.length > 0) {
    const detail = `nested .git/submodule paths inside scope are unsupported: ${inScope.slice(0, 3).join(", ")}`;
    params.warn(`coding-git-checkpoint: ${params.operation} scope covers nested .git at ${inScope.slice(0, 3).join(", ")}; unsupported`);
    return { ok: false, reason: detail };
  }
  params.warn(
    `coding-git-checkpoint: ${params.operation} explicitly skips out-of-scope nested .git at ${params.nestedRepos.slice(0, 3).join(", ")}`,
  );
  return { ok: true, skipped: [...params.nestedRepos] };
}


async function findRestorePathConflicts(
  root: string,
  targetPaths: readonly string[],
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const relPath of targetPaths) {
    const segments = relPath.split("/").filter(Boolean);
    let cursor = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      cursor = path.join(cursor, segments[index]!);
      try {
        const stat = await fs.lstat(cursor);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          conflicts.push(`${relPath}: ancestor path ${path.relative(root, cursor).split(path.sep).join("/")} is not a directory`);
        }
      } catch {
        // Missing ancestor directories are fine; checkout-index creates parents.
      }
    }
    try {
      const stat = await fs.lstat(path.join(root, relPath));
      if (stat.isDirectory() || stat.isSymbolicLink()) {
        conflicts.push(`${relPath}: target path is a ${stat.isDirectory() ? "directory" : "symbolic link"}`);
      }
    } catch {
      // Missing target is fine; checkout-index creates it.
    }
  }
  return conflicts;
}

/**
 * Structural conflicts that would make a checkout unsafe: a target path is a
 * directory or symlink, or an ancestor is not a real directory. Shared with the
 * P6B transaction so both restore paths reject the same shapes.
 */
export const findCheckpointRestoreConflicts = findRestorePathConflicts;

const CHECKPOINT_LABEL_MAX_LENGTH = 200;
const CHECKPOINT_TRAILER_VERSION = "openclaw-checkpoint-version";
const CHECKPOINT_TRAILER_LABEL = "openclaw-checkpoint-label";
const CHECKPOINT_TRAILER_SCOPE_KIND = "openclaw-checkpoint-scope-kind";
const CHECKPOINT_TRAILER_SCOPE = "openclaw-checkpoint-scope";

/** Strip control characters and bound the length of a caller-supplied label. */
export function sanitizeCheckpointLabel(label: string): string {
  const cleaned = label
    .replace(/[\r\n\t\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, CHECKPOINT_LABEL_MAX_LENGTH);
}

/** True when `candidate` is `entry` itself or nested under it. */
export function isPathUnderScopeEntry(candidate: string, entry: string): boolean {
  if (entry === candidate) return true;
  return candidate.startsWith(`${entry}/`);
}

/**
 * Normalize a caller path set into a checkpoint scope: POSIX-relative to the
 * workspace root, deduped, sorted, with redundant nested entries collapsed.
 * Workspace escapes and internal paths (`.git`, `.openclaw`) are rejected.
 */
export function normalizeCheckpointScope(
  root: string,
  paths: readonly string[],
): GitCheckpointScope {
  const resolvedRoot = path.resolve(root);
  const normalized = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw checkpointError("E_GIT_CHECKPOINT_FAILED", "checkpoint scope contains an empty path");
    }
    const absolute = path.resolve(resolvedRoot, raw);
    const prefix = `${resolvedRoot}${path.sep}`;
    if (absolute === resolvedRoot) {
      throw checkpointError(
        "E_GIT_CHECKPOINT_FAILED",
        "checkpoint scope may not be the workspace root; use a whole-tree checkpoint instead",
      );
    }
    if (!absolute.startsWith(prefix)) {
      throw checkpointError(
        "E_GIT_CHECKPOINT_FAILED",
        `checkpoint scope path escapes the workspace: ${raw}`,
      );
    }
    const relative = path
      .relative(resolvedRoot, absolute)
      .split(path.sep)
      .join("/")
      .replace(/\/+$/, "");
    if (relative === ".git" || relative.startsWith(".git/")) {
      throw checkpointError("E_GIT_CHECKPOINT_FAILED", "checkpoint scope may not include .git");
    }
    if (relative === ".openclaw" || relative.startsWith(".openclaw/")) {
      throw checkpointError("E_GIT_CHECKPOINT_FAILED", "checkpoint scope may not include .openclaw");
    }
    normalized.add(relative);
  }
  if (normalized.size === 0) {
    throw checkpointError("E_GIT_CHECKPOINT_FAILED", "checkpoint scope is empty");
  }
  const sorted = [...normalized].sort((a, b) => a.localeCompare(b));
  // Collapse entries already covered by an ancestor entry so the scope is minimal.
  const minimal: string[] = [];
  for (const entry of sorted) {
    if (minimal.some((existing) => isPathUnderScopeEntry(entry, existing))) continue;
    minimal.push(entry);
  }
  return { kind: "paths", paths: minimal };
}

/** Filter tree paths down to the ones covered by `scope`. */
export function treePathsInScope(
  treePaths: readonly string[],
  scope: GitCheckpointScope,
): string[] {
  if (scope.kind === "full") return [...treePaths];
  return treePaths.filter((treePath) =>
    scope.paths.some((entry) => isPathUnderScopeEntry(treePath, entry)),
  );
}

/**
 * Is every entry of `requested` covered by `recorded`?
 *
 * A restore removes in-scope paths that are absent from the checkpoint tree. So
 * requesting a scope the checkpoint never covered would delete that scope's
 * content on the grounds that the checkpoint "does not have it" -- which is a
 * data-destroying misread of a narrow checkpoint. A `full` checkpoint covers
 * everything, so only `paths` checkpoints constrain the request.
 */
export function scopeIsCoveredByCheckpointScope(
  requested: GitCheckpointScope,
  recorded: GitCheckpointScope,
): { covered: true } | { covered: false; uncovered: string[] } {
  if (recorded.kind === "full") return { covered: true };
  if (requested.kind === "full") {
    // A whole-tree restore of a path-scoped checkpoint is never inferred; the
    // caller-facing paths are resolved from the recorded scope instead.
    return { covered: true };
  }
  const uncovered = requested.paths.filter(
    (entry) => !recorded.paths.some((covered) => isPathUnderScopeEntry(entry, covered)),
  );
  return uncovered.length === 0 ? { covered: true } : { covered: false, uncovered };
}

/** Build the checkpoint commit message, embedding scope/label metadata trailers. */
export function encodeCheckpointMessage(params: {
  createdAt: string;
  scope: GitCheckpointScope;
  label?: string;
}): string {
  const lines = [
    `OpenClaw UFTK git checkpoint ${params.createdAt}`,
    "",
    `${CHECKPOINT_TRAILER_VERSION}: ${GIT_CHECKPOINT_METADATA_VERSION}`,
    `${CHECKPOINT_TRAILER_SCOPE_KIND}: ${params.scope.kind}`,
  ];
  if (params.label) {
    lines.push(`${CHECKPOINT_TRAILER_LABEL}: ${params.label}`);
  }
  for (const entry of params.scope.paths) {
    lines.push(`${CHECKPOINT_TRAILER_SCOPE}: ${entry}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Parse checkpoint metadata out of a commit message. P5 checkpoints carry no
 * trailers and resolve to the whole-tree scope, preserving their semantics.
 *
 * `createdAtMs` comes from the millisecond-resolution ISO timestamp in the
 * subject line, which is finer than git's second-resolution `creatordate` and is
 * what makes "newest" well-defined for checkpoints created inside one second.
 */
export function decodeCheckpointMetadata(message: string): {
  version: number;
  scope: GitCheckpointScope;
  label?: string;
  createdAtMs?: number;
} {
  let version = 1;
  let scopeKind: GitCheckpointScope["kind"] = "full";
  let label: string | undefined;
  const scopePaths: string[] = [];
  for (const line of message.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === CHECKPOINT_TRAILER_VERSION) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) version = parsed;
    } else if (key === CHECKPOINT_TRAILER_SCOPE_KIND) {
      if (value === "paths" || value === "full") scopeKind = value;
    } else if (key === CHECKPOINT_TRAILER_LABEL) {
      if (value) label = value;
    } else if (key === CHECKPOINT_TRAILER_SCOPE) {
      if (value) scopePaths.push(value);
    }
  }
  const scope: GitCheckpointScope =
    scopeKind === "paths" && scopePaths.length > 0
      ? { kind: "paths", paths: scopePaths.sort((a, b) => a.localeCompare(b)) }
      : FULL_CHECKPOINT_SCOPE;
  const stamp = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.exec(message);
  const createdAtMs = stamp ? Date.parse(stamp[0]) : Number.NaN;
  return {
    version,
    scope,
    ...(label ? { label } : {}),
    ...(Number.isFinite(createdAtMs) ? { createdAtMs } : {}),
  };
}

export type GitCheckpointRestorePlan = {
  scope: GitCheckpointScope;
  /** Every path in the checkpoint tree. */
  treePaths: string[];
  /** In-scope tree paths to materialize. */
  restorePaths: string[];
  /** In-scope existing paths absent from the checkpoint tree; removed by apply. */
  removePaths: string[];
  conflicts: string[];
};

/**
 * Resolve which paths a restore touches. Out-of-scope paths never enter
 * `restorePaths` or `removePaths`, which is what keeps a scoped restore from
 * disturbing unrelated working-tree content.
 */
export function buildCheckpointRestorePlan(params: {
  scope: GitCheckpointScope;
  treePaths: readonly string[];
  beforeTracked: readonly string[];
  beforeUntracked: readonly string[];
}): Omit<GitCheckpointRestorePlan, "conflicts"> {
  const restorePaths = treePathsInScope(params.treePaths, params.scope);
  const treeSet = new Set(params.treePaths);
  const removePaths: string[] = [];
  for (const existing of [...params.beforeTracked, ...params.beforeUntracked]) {
    if (treeSet.has(existing)) continue;
    if (isInternalRestorePath(existing)) continue;
    if (params.scope.kind === "paths") {
      const inScope = params.scope.paths.some((entry) => isPathUnderScopeEntry(existing, entry));
      if (!inScope) continue;
    }
    if (!removePaths.includes(existing)) removePaths.push(existing);
  }
  return {
    scope: params.scope,
    treePaths: [...params.treePaths],
    restorePaths,
    removePaths,
  };
}

/** Split a path list into argv batches that stay well under OS command-line limits. */
function batchPathArgs(paths: readonly string[], maxChars = 24_000): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const item of paths) {
    if (current.length > 0 && length + item.length + 1 > maxChars) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(item);
    length += item.length + 1;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * The single worktree-mutating restore primitive, shared by the P5 whole-tree
 * restore and the P6B two-phase transaction. Never uses `git reset --hard` or
 * `git clean -f`.
 *
 * Whole-tree mode reproduces the accepted P5 sequence exactly (checkout-index
 * -a -f, real-index `read-tree`, then scoped extraneous removal). Scoped mode
 * materializes only in-scope tree paths, removes only in-scope extraneous
 * paths, and refreshes only those index entries so out-of-scope index state is
 * left untouched.
 */
export async function applyCheckpointToWorktree(params: {
  root: string;
  checkpointId: string;
  plan: Omit<GitCheckpointRestorePlan, "conflicts">;
  stateDir: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<void> {
  const tempIndex = path.join(params.stateDir, "tmp", `uftk-restore-index-${randomUUID()}`);
  await fs.mkdir(path.dirname(tempIndex), { recursive: true, mode: 0o700 });
  const gitEnv: GitEnv = { ...params.env, GIT_INDEX_FILE: tempIndex };
  const scoped = params.plan.scope.kind === "paths";
  try {
    await runGit({
      args: ["read-tree", params.checkpointId],
      cwd: params.root,
      env: gitEnv,
      timeoutMs: params.timeoutMs,
    });

    if (!scoped) {
      await runGit({
        args: ["checkout-index", "-a", "-f"],
        cwd: params.root,
        env: gitEnv,
        timeoutMs: params.timeoutMs,
      });
      await runGit({
        args: ["read-tree", params.checkpointId],
        cwd: params.root,
        env: params.env,
        timeoutMs: params.timeoutMs,
      });
    } else if (params.plan.restorePaths.length > 0) {
      // Pre-create leading directories so checkout-index never has to guess.
      const parents = new Set(
        params.plan.restorePaths
          .map((relPath) => path.dirname(safeJoinRoot(params.root, relPath)))
          .filter((dir) => path.resolve(dir) !== path.resolve(params.root)),
      );
      for (const dir of parents) {
        await fs.mkdir(dir, { recursive: true });
      }
      for (const batch of batchPathArgs(params.plan.restorePaths)) {
        await runGit({
          args: ["checkout-index", "-f", "--", ...batch],
          cwd: params.root,
          env: gitEnv,
          timeoutMs: params.timeoutMs,
        });
      }
    }

    for (const relPath of params.plan.removePaths) {
      await fs.rm(safeJoinRoot(params.root, relPath), { force: true });
    }

    if (scoped) {
      const indexPaths = [...params.plan.restorePaths, ...params.plan.removePaths];
      for (const batch of batchPathArgs(indexPaths)) {
        await runGit({
          args: ["update-index", "--add", "--remove", "--", ...batch],
          cwd: params.root,
          env: params.env,
          timeoutMs: params.timeoutMs,
        });
      }
    }
  } finally {
    await fs.rm(tempIndex, { force: true });
  }
}

/**
 * Which of these paths would `git add` refuse as ignored?
 *
 * `git add -A -- <explicitly named ignored path>` fails outright ("The following
 * paths are ignored by one of your .gitignore files"), so an ignored path in a
 * scope is the same hazard as a missing one: it aborts the whole staging step.
 * `check-ignore` exits 1 when none of the given paths are ignored, which is a
 * normal answer rather than an error.
 *
 * Output is newline-separated because `-z` is only accepted together with
 * `--stdin`, which `runGit` has no channel for. `core.quotePath=false` keeps
 * non-ASCII paths verbatim. A path containing a newline cannot be round-tripped
 * this way, so it is left unchecked and reported as not-ignored -- `git add` then
 * surfaces the real error itself rather than this helper guessing.
 */
export async function listIgnoredCheckpointPaths(params: {
  root: string;
  paths: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<Set<string>> {
  const ignored = new Set<string>();
  const checkable = params.paths.filter((entry) => !/[\r\n]/.test(entry));
  if (checkable.length === 0) return ignored;
  const known = new Set(checkable);
  for (const batch of batchPathArgs(checkable)) {
    let raw: string;
    try {
      raw = await runGit({
        args: ["-c", "core.quotePath=false", "check-ignore", "--", ...batch],
        cwd: params.root,
        env: params.env,
        timeoutMs: params.timeoutMs,
      });
    } catch {
      // Exit 1 means "none of these are ignored". Any other failure means we
      // cannot prove anything, and assuming stageable is the safe direction:
      // `git add` will then surface the real error itself.
      continue;
    }
    for (const line of splitLines(raw)) {
      const normalized = line.replace(/\\/g, "/");
      if (known.has(normalized)) ignored.add(normalized);
    }
  }
  return ignored;
}

/**
 * Which of these scope paths can `git add -A` actually match right now?
 *
 * A pathspec that matches nothing makes `git add` fail outright, and a temp
 * index starts empty so there is no index entry to match either. For a snapshot
 * of the *current* worktree that is the wrong failure mode: a scope path with
 * nothing on disk simply contributes nothing, and its absence is exactly what
 * the snapshot should record. An existing but empty directory matches nothing
 * for the same reason, and an ignored path is refused outright.
 */
async function filterMatchablePathspecs(params: {
  root: string;
  paths: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<string[]> {
  const present: string[] = [];
  for (const relPath of params.paths) {
    const absPath = safeJoinRoot(params.root, relPath);
    let stat;
    try {
      stat = await fs.lstat(absPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      present.push(relPath);
      continue;
    }
    try {
      const entries = await fs.readdir(absPath);
      if (entries.length > 0) present.push(relPath);
    } catch {
      // Unreadable directory: leave it out rather than fail the whole snapshot.
    }
  }
  if (present.length === 0) return present;
  const ignored = await listIgnoredCheckpointPaths({
    root: params.root,
    paths: present,
    env: params.env,
    timeoutMs: params.timeoutMs,
  });
  return ignored.size === 0 ? present : present.filter((relPath) => !ignored.has(relPath));
}

/**
 * Write a checkpoint tree + commit + private ref. With a `paths` scope the temp
 * index is populated only from the requested paths, so the resulting tree
 * contains exactly the scope. The real index and worktree are never modified.
 *
 * `refPrefix` selects the ref namespace. Safety snapshots pass
 * `GIT_CHECKPOINT_SAFETY_REF_PREFIX` so they are unreachable from the lifecycle
 * retention surface.
 *
 * `skipMissingPaths` drops scope entries `git add` would refuse -- absent from
 * disk, an empty directory, or gitignored -- instead of failing. Safety snapshots
 * need this: a restore scope legitimately names files that do not exist yet (a
 * deleted file being put back) and files git will not stage (a build artifact),
 * and refusing to snapshot in those cases would leave the restore with no safety
 * net at all. Ordinary `createCheckpoint` leaves it off, so naming a path that is
 * not there is still a structured failure.
 */
export async function writeCheckpointCommit(params: {
  root: string;
  scope: GitCheckpointScope;
  label?: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  refPrefix?: string;
  skipMissingPaths?: boolean;
}): Promise<{ commit: string; ref: string; createdAt: string; parent?: string }> {
  const tempIndex = path.join(params.stateDir, "tmp", `uftk-checkpoint-index-${randomUUID()}`);
  await fs.mkdir(path.dirname(tempIndex), { recursive: true, mode: 0o700 });
  const gitEnv: GitEnv = { ...params.env, GIT_INDEX_FILE: tempIndex };
  try {
    let scopePaths = params.scope.paths;
    if (params.scope.kind === "paths" && params.skipMissingPaths) {
      scopePaths = await filterMatchablePathspecs({
        root: params.root,
        paths: scopePaths,
        env: params.env,
        timeoutMs: params.timeoutMs,
      });
    }
    const pathspec =
      params.scope.kind === "full"
        ? [".", ":(exclude).openclaw"]
        : [...scopePaths, ":(exclude).openclaw"];
    // With every scope path absent the tree is legitimately empty; running
    // `git add` with only the exclude pathspec would fail instead.
    if (params.scope.kind === "full" || scopePaths.length > 0) {
      await runGit({
        args: ["add", "-A", "--", ...pathspec],
        cwd: params.root,
        env: gitEnv,
        timeoutMs: params.timeoutMs,
      });
    }
    const tree = (
      await runGit({
        args: ["write-tree"],
        cwd: params.root,
        env: gitEnv,
        timeoutMs: params.timeoutMs,
      })
    ).trim();
    let parent: string | undefined;
    try {
      parent = (
        await runGit({
          args: ["rev-parse", "--verify", "HEAD"],
          cwd: params.root,
          env: params.env,
          timeoutMs: params.timeoutMs,
        })
      ).trim();
    } catch {
      parent = undefined;
    }
    const createdAt = new Date().toISOString();
    const message = encodeCheckpointMessage({
      createdAt,
      scope: params.scope,
      ...(params.label ? { label: params.label } : {}),
    });
    const commit = (
      await runGit({
        args: ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message],
        cwd: params.root,
        env: gitEnv,
        timeoutMs: params.timeoutMs,
      })
    ).trim();
    const ref = `${params.refPrefix ?? GIT_CHECKPOINT_REF_PREFIX}/${commit}`;
    await runGit({
      args: ["update-ref", ref, commit],
      cwd: params.root,
      env: params.env,
      timeoutMs: params.timeoutMs,
    });
    return { commit, ref, createdAt, ...(parent ? { parent } : {}) };
  } finally {
    await fs.rm(tempIndex, { force: true });
  }
}

/** Resolve every path contained in a checkpoint tree. */
export async function resolveCheckpointTreePaths(params: {
  root: string;
  checkpointId: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<string[]> {
  return splitLines(
    await runGit({
      args: ["ls-tree", "-r", "--name-only", params.checkpointId],
      cwd: params.root,
      env: params.env,
      timeoutMs: params.timeoutMs,
    }),
  );
}

/** Read the raw commit message of a checkpoint (used for scope/label metadata). */
export async function readCheckpointCommitMessage(params: {
  root: string;
  checkpointId: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<string> {
  return await runGit({
    args: ["log", "-1", "--format=%B", params.checkpointId],
    cwd: params.root,
    env: params.env,
    timeoutMs: params.timeoutMs,
  });
}

export type GitCheckpointCreateOptions = {
  /** P6B: restrict the checkpoint to these paths. Requires the pathScoped flag. */
  paths?: readonly string[];
  /** P6B: human-readable label recorded in the checkpoint metadata. */
  label?: string;
};

export type GitCheckpointRestoreOptions = {
  /**
   * P6B: restrict the restore to these paths. Requires the pathScoped flag.
   * When omitted, the checkpoint's own recorded scope is used, so restoring a
   * path-scoped checkpoint never touches paths outside that scope.
   */
  paths?: readonly string[];
};

/**
 * Public support-resolution entry point for the P6B modules. Wraps the layout
 * resolution and hands back the nested-repo policy closure so every caller
 * applies the same submodule rules.
 */
export async function resolveGitCheckpointSupport(params: {
  root: string;
  enabled: boolean;
  warn: (message: string) => void;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}): Promise<
  | {
      ok: true;
      layout: GitCheckpointLayout;
      resolveNestedPolicy: (
        scope: GitCheckpointScope,
        operation: string,
      ) => { ok: true; skipped: string[] } | { ok: false; reason: string };
    }
  | { ok: false; reason: string; code: string }
> {
  const resolved = await resolveGitCheckpointContext(params);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    layout: resolved.layout,
    resolveNestedPolicy: (scope, operation) =>
      resolveNestedRepoPolicy({
        nestedRepos: resolved.layout.nestedRepos,
        scope,
        warn: params.warn,
        operation,
      }),
  };
}

export class GitCheckpointService {
  readonly workspaceRoot: string;
  readonly #enabled: boolean;
  readonly #pathScopedEnabled: boolean;
  readonly #concurrencyV2Enabled: boolean;
  readonly #stateDir: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #gitTimeoutMs: number;
  readonly #restoreLockTimeoutMs: number;
  readonly #warn: (message: string) => void;

  constructor(options: GitCheckpointServiceOptions) {
    this.workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot);
    this.#enabled = options.enabled ?? false;
    this.#pathScopedEnabled = options.pathScopedEnabled ?? false;
    this.#concurrencyV2Enabled = options.concurrencyV2Enabled ?? false;
    this.#env = options.env ?? process.env;
    this.#stateDir = options.stateDir
      ? path.resolve(options.stateDir)
      : resolveStateDir(this.#env);
    this.#gitTimeoutMs = options.gitTimeoutMs ?? 30_000;
    this.#restoreLockTimeoutMs = options.restoreLockTimeoutMs ?? 60_000;
    this.#warn = options.warn ?? ((message) => console.warn(message));
  }

  /** Internal accessors so the P6B safety/transaction modules reuse one config. */
  get internals(): {
    enabled: boolean;
    pathScopedEnabled: boolean;
    concurrencyV2Enabled: boolean;
    stateDir: string;
    env: NodeJS.ProcessEnv;
    gitTimeoutMs: number;
    restoreLockTimeoutMs: number;
    warn: (message: string) => void;
  } {
    return {
      enabled: this.#enabled,
      pathScopedEnabled: this.#pathScopedEnabled,
      concurrencyV2Enabled: this.#concurrencyV2Enabled,
      stateDir: this.#stateDir,
      env: this.#env,
      gitTimeoutMs: this.#gitTimeoutMs,
      restoreLockTimeoutMs: this.#restoreLockTimeoutMs,
      warn: this.#warn,
    };
  }

  async createCheckpoint(options: GitCheckpointCreateOptions = {}): Promise<GitCheckpointCreateResult> {
    const wantsScope = options.paths !== undefined;
    if ((wantsScope || options.label !== undefined) && !this.#pathScopedEnabled) {
      // Label metadata rides the same P6B surface as path scoping.
      return {
        status: "disabled",
        reason: "path-scoped checkpoints are disabled (runtime.coding.uftk.gitCheckpoint.pathScoped.enabled)",
      };
    }
    const repo = await resolveGitCheckpointContext({
      root: this.workspaceRoot,
      enabled: this.#enabled,
      warn: this.#warn,
      timeoutMs: this.#gitTimeoutMs,
      env: this.#env,
    });
    if (!repo.ok) {
      return {
        status: repo.code === "E_GIT_CHECKPOINT_DISABLED" ? "disabled" : "unsupported",
        reason: repo.reason,
      };
    }
    const root = repo.layout.root;

    let scope: GitCheckpointScope;
    try {
      scope = wantsScope
        ? normalizeCheckpointScope(root, options.paths ?? [])
        : FULL_CHECKPOINT_SCOPE;
    } catch (caught) {
      const message = gitErrorMessage(caught);
      return {
        status: "failed",
        reason: message,
        error: {
          code: caught instanceof CodingRuntimeError ? caught.code : "E_GIT_CHECKPOINT_FAILED",
          message,
        },
      };
    }

    const nested = resolveNestedRepoPolicy({
      nestedRepos: repo.layout.nestedRepos,
      scope,
      warn: this.#warn,
      operation: "create",
    });
    if (!nested.ok) {
      return { status: "unsupported", reason: nested.reason };
    }

    const beforeStatus = await runGit({
      args: ["status", "--porcelain=v1"],
      cwd: root,
      env: this.#env,
      timeoutMs: this.#gitTimeoutMs,
    });

    try {
      const label = options.label ? sanitizeCheckpointLabel(options.label) : undefined;
      const written = await writeCheckpointCommit({
        root,
        scope,
        ...(label ? { label } : {}),
        stateDir: this.#stateDir,
        env: this.#env,
        timeoutMs: this.#gitTimeoutMs,
      });
      const afterStatus = await runGit({
        args: ["status", "--porcelain=v1"],
        cwd: root,
        env: this.#env,
        timeoutMs: this.#gitTimeoutMs,
      });
      return {
        status: "created",
        checkpoint: {
          id: written.commit,
          commit: written.commit,
          ref: written.ref,
          createdAt: written.createdAt,
          createdAtMs: Date.parse(written.createdAt),
          workspaceRoot: root,
          scope,
          ...(label ? { label } : {}),
          ...(written.parent ? { parent: written.parent } : {}),
        },
        indexWorktreeUnchanged: beforeStatus === afterStatus,
        ...(nested.skipped.length > 0 ? { skippedNestedRepos: nested.skipped } : {}),
      };
    } catch (caught) {
      const code = caught instanceof CodingRuntimeError ? caught.code : "E_GIT_CHECKPOINT_FAILED";
      return {
        status: "failed",
        reason: gitErrorMessage(caught),
        error: { code, message: gitErrorMessage(caught) },
      };
    }
  }

  async listCheckpoints(): Promise<GitCheckpointListResult> {
    if (!this.#enabled) {
      return { status: "disabled", checkpoints: [], reason: "git checkpoint is disabled" };
    }
    try {
      const checkpoints = await readCheckpointRecords({
        root: this.workspaceRoot,
        env: this.#env,
        timeoutMs: this.#gitTimeoutMs,
      });
      return { status: "ok", checkpoints };
    } catch (caught) {
      return {
        status: "unsupported",
        checkpoints: [],
        reason: caught instanceof CodingRuntimeError ? caught.message : gitErrorMessage(caught),
      };
    }
  }

  /**
   * Restore a checkpoint.
   *
   * With no options and a whole-tree checkpoint this is the accepted P5 path.
   * With `paths`, or for a checkpoint that recorded its own `paths` scope, the
   * restore is confined to that scope: out-of-scope worktree and index state is
   * left byte-identical.
   *
   * This entry point does not take a safety snapshot. The two-phase,
   * safety-backed restore lives in `git-checkpoint-transaction.ts`.
   */
  async restoreCheckpoint(
    checkpointId: string,
    options: GitCheckpointRestoreOptions = {},
  ): Promise<GitCheckpointRestoreResult> {
    if (options.paths !== undefined && !this.#pathScopedEnabled) {
      return {
        status: "disabled",
        checkpointId,
        reason: "path-scoped restore is disabled (runtime.coding.uftk.gitCheckpoint.pathScoped.enabled)",
      };
    }
    const repo = await resolveGitCheckpointContext({
      root: this.workspaceRoot,
      enabled: this.#enabled,
      warn: this.#warn,
      timeoutMs: this.#gitTimeoutMs,
      env: this.#env,
    });
    if (!repo.ok) {
      return {
        status: repo.code === "E_GIT_CHECKPOINT_DISABLED" ? "disabled" : "unsupported",
        checkpointId,
        reason: repo.reason,
      };
    }
    const root = repo.layout.root;

    // Nested-repo policy is evaluated against the *requested* scope, before the
    // checkpoint is resolved, so a whole-tree restore in a repo with nested
    // `.git` markers still returns `unsupported` exactly as in P5. A scoped
    // restore must state its scope explicitly to opt into the skip+warning
    // path; we never infer it from checkpoint metadata here, because that would
    // silently half-support submodules.
    let requestedScope: GitCheckpointScope;
    try {
      requestedScope =
        options.paths !== undefined
          ? normalizeCheckpointScope(root, options.paths)
          : FULL_CHECKPOINT_SCOPE;
    } catch (caught) {
      const message = gitErrorMessage(caught);
      return {
        status: "failed",
        checkpointId,
        reason: message,
        error: {
          code: caught instanceof CodingRuntimeError ? caught.code : "E_GIT_CHECKPOINT_FAILED",
          message,
        },
      };
    }
    const nested = resolveNestedRepoPolicy({
      nestedRepos: repo.layout.nestedRepos,
      scope: requestedScope,
      warn: this.#warn,
      operation: "restore",
    });
    if (!nested.ok) {
      return { status: "unsupported", checkpointId, reason: nested.reason };
    }

    let targetPaths: string[];
    try {
      targetPaths = await resolveCheckpointTreePaths({
        root,
        checkpointId,
        env: this.#env,
        timeoutMs: this.#gitTimeoutMs,
      });
    } catch {
      return {
        status: "not_found",
        checkpointId,
        reason: `checkpoint ${checkpointId} does not resolve to a git tree`,
        error: { code: "E_GIT_CHECKPOINT_NOT_FOUND", message: `checkpoint not found: ${checkpointId}` },
      };
    }

    // Effective scope: explicit request first, otherwise the checkpoint's own
    // recorded scope. Restoring a scoped checkpoint must never be widened into
    // a whole-tree restore, which would delete everything outside its tree, and
    // an explicit request may not reach outside what the checkpoint covers.
    let scope: GitCheckpointScope;
    try {
      const recordedScope = decodeCheckpointMetadata(
        await readCheckpointCommitMessage({
          root,
          checkpointId,
          env: this.#env,
          timeoutMs: this.#gitTimeoutMs,
        }),
      ).scope;
      if (options.paths === undefined) {
        scope = recordedScope;
      } else {
        const coverage = scopeIsCoveredByCheckpointScope(requestedScope, recordedScope);
        if (!coverage.covered) {
          const detail =
            `requested restore scope is not covered by checkpoint ${checkpointId} ` +
            `(scope: ${recordedScope.paths.join(", ")}); uncovered: ${coverage.uncovered.join(", ")}`;
          this.#warn(`coding-git-checkpoint: ${detail}`);
          return {
            status: "failed",
            checkpointId,
            reason: detail,
            error: { code: "E_GIT_CHECKPOINT_FAILED", message: detail },
          };
        }
        scope = requestedScope;
      }
    } catch (caught) {
      const message = gitErrorMessage(caught);
      return {
        status: "failed",
        checkpointId,
        reason: message,
        error: {
          code: caught instanceof CodingRuntimeError ? caught.code : "E_GIT_CHECKPOINT_FAILED",
          message,
        },
      };
    }

    const lockKey = path.resolve(root).toLowerCase();
    const sessionFile = workspaceLockKey(root, this.#env);
    const runRestore = async (): Promise<GitCheckpointRestoreResult> =>
      withRestoreLock({
        key: lockKey,
        sessionFile,
        timeoutMs: this.#restoreLockTimeoutMs,
        env: this.#env,
        fn: async () => {
          const beforeTracked = splitNullSeparated(
            await runGit({
              args: ["ls-files", "-z"],
              cwd: root,
              env: this.#env,
              timeoutMs: this.#gitTimeoutMs,
            }),
          );
          const beforeUntracked = splitNullSeparated(
            await runGit({
              args: ["ls-files", "--others", "--exclude-standard", "-z"],
              cwd: root,
              env: this.#env,
              timeoutMs: this.#gitTimeoutMs,
            }),
          );
          const beforeStatus = await runGit({
            args: ["status", "--porcelain=v1", "-z"],
            cwd: root,
            env: this.#env,
            timeoutMs: this.#gitTimeoutMs,
          });
          const plan = buildCheckpointRestorePlan({
            scope,
            treePaths: targetPaths,
            beforeTracked,
            beforeUntracked,
          });
          const diagnostic = {
            beforeStatus,
            beforeTracked,
            beforeUntracked,
            targetPaths,
            scope,
            removedPaths: plan.removePaths,
            ...(nested.skipped.length > 0 ? { skippedNestedRepos: nested.skipped } : {}),
          };
          const conflicts = await findRestorePathConflicts(root, plan.restorePaths);
          if (conflicts.length > 0) {
            const detail = conflicts.slice(0, 3).join("; ");
            this.#warn(`coding-git-checkpoint: restore ${checkpointId} conflict: ${detail}`);
            return {
              status: "conflict",
              checkpointId,
              reason: detail,
              error: { code: "E_GIT_CHECKPOINT_CONFLICT", message: detail },
              diagnostic,
            };
          }
          try {
            await applyCheckpointToWorktree({
              root,
              checkpointId,
              plan,
              stateDir: this.#stateDir,
              env: this.#env,
              timeoutMs: this.#gitTimeoutMs,
            });
            return { status: "restored" as const, checkpointId, diagnostic } as GitCheckpointRestoreResult;
          } catch (caught) {
            const code =
              caught instanceof CodingRuntimeError && caught.code === "E_GIT_CHECKPOINT_TIMEOUT"
                ? "E_GIT_CHECKPOINT_TIMEOUT"
                : "E_GIT_CHECKPOINT_FAILED";
            this.#warn(
              `coding-git-checkpoint: restore ${checkpointId} failed: ${gitErrorMessage(caught)}`,
            );
            return {
              status: "failed",
              checkpointId,
              reason: gitErrorMessage(caught),
              error: { code, message: gitErrorMessage(caught) },
              diagnostic,
            };
          }
        },
      });

    if (!this.#concurrencyV2Enabled) {
      return await runRestore();
    }
    // P6A barrier: exclude new UFTK write prepares and drain existing writers
    // for the whole restore. Only engaged when concurrencyV2 is enabled so the
    // flag-off path stays byte-identical to P5.
    const barrierStartedAt = Date.now();
    let barrier;
    try {
      barrier = await acquireWorkspaceRestoreBarrier(root, {
        owner: `uftk-git-restore:${process.pid}`,
        timeoutMs: this.#restoreLockTimeoutMs,
      });
    } catch (caught) {
      const message = gitErrorMessage(caught);
      return {
        status: "failed",
        checkpointId,
        reason: message,
        error: {
          code: caught instanceof CodingRuntimeError ? caught.code : "E_LOCK_TIMEOUT",
          message,
        },
      };
    }
    codingObservability.recordRestoreBarrierWaitMs(Date.now() - barrierStartedAt);
    try {
      return await runRestore();
    } finally {
      await barrier.release();
    }
  }
}
