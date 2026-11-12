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
import { createHash, randomUUID } from "node:crypto";
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
import { withTaskLedgerJournalLock, withTaskLedgerJournalLockSync } from '../../../shared/task-ledger-journal-lock.js';
import { assertNoSymlinkParentsSync, resolveRootPathSync, safePathSegmentHashed } from "@openclaw/fs-safe/advanced";
import { acquirePatchBatchLocks } from "./apply-patch-batch-lock.js";
import {
  LongSessionCoordinationError,
  decideLongSessionCoordination,
  resolveLongSessionCoordinationPolicy,
} from '../../../shared/long-session-resource-reclamation.js';
import { codingObservability } from '../context-engine/coding-observability.js';
import { assertVerseGitCleanupDeletionAllowed, verseGitCleanupResourceId } from '../../../shared/versegit-cleanup-barrier.js';
import type { VerseGitCleanupDeletionAuthorization } from '../../../shared/types/versegit.js';
import type { WorktreeBackend } from "../context-engine/coding-runtime-flags.js";
import { withExecutionTaskWorktreeCleanup, finishExecutionTaskWorktreeCleanup, openExecutionTaskStore, type TaskWorktreeCleanupBinding } from "./execution-task-authority.js";
import type { TaskCredential } from '../../../shared/task-system/types.js';
import { assertGitNativeRoot, nativeGitWorktreeRoot, isSharedGitRef } from '../../../shared/git-native-root.js';
import { applyWorktreeFiles, captureWorktreeFiles, captureWorktreeModes, changedWorktreeFiles, nativeFilename, readWorktreeFile, worktreeContentHash } from "./worktree-merge-files.js";
import { reviewDiff } from "../context-engine/views/verify/review-diff-view.js";
import type { FactStore } from "../context-engine/factstore/store.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { registerExecutionDomain, resolveExecutionDomain } from "./execution-domain.js";
import {
  beginCheckoutWrite, checkoutWriterSnapshot, claimCheckoutWriter, drainCheckoutWriter,
  releaseCheckoutWriter, releaseUnusedCheckoutWriter, settleCheckoutWrite, withCheckoutMaintenance,
  finishRemovedCheckoutCleanup, transferCheckoutWriter, endCheckoutWriter, withAsyncCheckoutMaintenance, recoverPreparedCheckoutMaintenance,
  type CheckoutWriteReceipt, type CheckoutWriterCredential, type CheckoutWriterIdentity, type CheckoutWriterBasis,
} from "./worktree-writer.js";
import {
  canonicalWorktreePath, filesystemInstance, findManagedWorktreeByRoot, loadWorktreeRegistryScope, observeWorktree,
  saveWorktreeRegistryScope, worktreeNativeIdentity,
  type WorktreeAvailability, type WorktreeRegistration,
} from "./worktree-registry.js";
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
  status: "creating" | "active" | "merged" | "cleaning" | "cleaned" | "conflict";
  registration: WorktreeRegistration;
  writeSet?: string[];
  backend: WorktreeBackend;
  gitBranch?: string;
  baseOid?: string;
  owner?: WorktreeLifecycleOwner;
  taskCleanup?: TaskWorktreeCleanupBinding;
  mergeBaseline?: { parent: Record<string, string>; worker: Record<string, string>; workerModes?: Record<string, number>; restoredFromBase?: boolean };
  mergeResult?: MergeQueueItem;
};

export type MergeQueueItem = {
  worktreeId: string;
  worktreeGeneration?: string;
  changedFiles: string[];
  status: "pending" | "merged" | "conflict" | "rework";
  review?: { relatedTests: string[]; riskLevel: string };
  reason?: string;
  journalRef?: string;
  recoveryRequired?: boolean;
  hashes?: Record<string, string | null>;
  expectedPostimages?: Record<string, string | null>;
};

/** Safe default marks conflict; optional policies return work to worker or escalate lead. */
export type MergeConflictPolicy = "mark_conflict" | "return_worker" | "escalate_lead";

export type WorktreeChangedFiles = {
  files: string[];
  source: "git-status" | "filesystem-snapshot" | "declared-writeSet" | "worktree-snapshot" | "unavailable";
};

export type WorktreeIsolationInspection =
  | { status: 'verified'; root: string; generation: string; headOid: string; gitDir: string; commonDir: string }
  | { status: 'unverified'; reason: 'missing-worktree' | 'stale-generation' | 'simulated-backend' | 'checkout-mismatch' | 'owner-unavailable' };

export type WorktreeService = {
  backend: WorktreeBackend;
  create(id: string, options?: { operationId?: string; writeSet?: string[]; seedFiles?: string[]; installStrategy?: WorktreeInstallStrategy; owner?: WorktreeLifecycleOwner }): WorktreeRecord & { install?: WorktreeInstallResult };
  pathFor(id: string): string;
  list(): WorktreeRecord[];
  inventory(): Array<{ id: string; root: string; availability: WorktreeAvailability | "unowned"; record?: WorktreeRecord }>;
  taskAuthority(expectedProjectRevision?: number): ReturnType<typeof resolveExecutionDomain>;
  registerTaskAuthority(input: Omit<Parameters<typeof registerExecutionDomain>[0], "workspaceRoot">): ReturnType<typeof registerExecutionDomain>;
  writerBasis(id: string | null): CheckoutWriterBasis;
  claimWriter(id: string | null, generation: string, owner: CheckoutWriterIdentity, requestId: string, expiresAt?: number | null): CheckoutWriterCredential;
  beginWrite(credential: CheckoutWriterCredential, operationId: string, requestDigest: string): ReturnType<typeof beginCheckoutWrite>;
  settleWrite(credential: CheckoutWriterCredential, operationId: string, receipt: CheckoutWriteReceipt | null): void;
  drainWriter(credential: CheckoutWriterCredential): void;
  endWriter(credential: CheckoutWriterCredential, receipt: Parameters<typeof endCheckoutWriter>[1]): void;
  transferWriter(credential: CheckoutWriterCredential, owner: CheckoutWriterIdentity, requestId: string): CheckoutWriterCredential;
  releaseWriter(credential: CheckoutWriterCredential): void;
  releaseUnusedWriter(credential: CheckoutWriterCredential): void;
  writer(id: string | null): ReturnType<typeof checkoutWriterSnapshot>;
  withFrozenWorktrees<T>(workers: readonly { worktreeId: string; worktreeGeneration: string }[], freeze: () => T): T;
  inspectIsolation(id: string, generation: string): WorktreeIsolationInspection;
  listChangedFiles(id: string, expectedGeneration?: string): WorktreeChangedFiles;
  enqueueMerge(item: Omit<MergeQueueItem, "status"> & { status?: MergeQueueItem["status"] }): MergeQueueItem;
  processMergeQueue(
    factStore?: FactStore,
    options?: { conflictPolicy?: MergeConflictPolicy; worktreeIds?: readonly string[]; assertParentCurrent?: () => void },
  ): Promise<MergeQueueItem[]>;
  cleanup(id: string, options?: { authorization?: VerseGitCleanupDeletionAuthorization; expectedGeneration?: string }): void;
  listOwned(owner: Pick<WorktreeLifecycleOwner, "sessionKey" | "agentId" | "expectedSessionId">): WorktreeRecord[];
  cleanupOwned(owner: Pick<WorktreeLifecycleOwner, "sessionKey" | "agentId" | "expectedSessionId">): WorktreeLifecycleResult;
  getMergeQueue(): MergeQueueItem[];
};

export type CreateWorktreeServiceOptions = {
  backend?: WorktreeBackend;
  conflictPolicy?: MergeConflictPolicy;
};

const scope = loadWorktreeRegistryScope;
const issuedRecords = new WeakSet<WorktreeRecord>();

export function isManagedWorktreeCurrent(record: WorktreeRecord | undefined): boolean {
  if (!record || !issuedRecords.has(record)) return false;
  try {
    const current = scope(record.baseRoot).records.get(record.id);
    return Boolean(current && current.generation === record.generation && current.root === record.root
      && observeWorktree(current) === "ready");
  } catch { return false; }
}

export function isVerifiedGitWorktree(record: WorktreeRecord | undefined): boolean {
  return Boolean(record && record.backend === "git" && isManagedWorktreeCurrent(record)
    && createWorktreeService(record.baseRoot).inspectIsolation(record.id, record.generation).status === "verified");
}

export function findManagedWorktree(root: string, id: string): WorktreeRecord | undefined {
  try {
    const baseRoot = path.resolve(root, "../../..");
    const record = scope(baseRoot).records.get(safeWorktreeId(id));
    return record && canonicalPath(record.root) === canonicalPath(root) ? recordSnapshot(record) : undefined;
  } catch { return undefined; }
}

function safeWorktreeId(id: string): string {
  if (!id || id !== id.trim() || id.startsWith(".") || /[. ]$/.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) {
    throw new Error("unsafe_worktree_id");
  }
  return /^[a-zA-Z0-9._-]{1,64}$/.test(id) ? id : safePathSegmentHashed(id);
}

function pathEntryExists(target: string): boolean {
  try { lstatSync(target); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function recordSnapshot(record: WorktreeRecord): WorktreeRecord {
  const snapshot = structuredClone(record);
  issuedRecords.add(snapshot);
  return snapshot;
}

function assertCurrentWorktree(record: WorktreeRecord): void {
  const availability = observeWorktree(record);
  if (availability !== "ready") throw new Error(`worktree_${availability}:${record.id}`);
}

function canonicalPath(target: string): string {
  const resolved = realpathSync.native(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Normalize relative paths for Windows separators and reject traversal. */
export function normalizeWorktreeRelPath(rel: string): string {
  const cleaned = (process.platform === 'win32' ? rel.replace(/\\/g, "/") : rel).replace(/^\/+/, "");
  const parts = cleaned.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new Error(`unsafe_worktree_rel_path:${rel}`);
  }
  return parts.join("/");
}

export function worktreeRelPathKey(rel: string, root?: string, alternate?: string): string {
  const normalized = normalizeWorktreeRelPath(rel);
  if (typeof root === 'string') {
    return nativeFilename(existsSync(path.join(root, normalized)) || !alternate ? root : alternate, normalized);
  }
  return normalized;
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
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
    GIT_CONFIG_KEY_2: "core.longpaths",
    GIT_CONFIG_VALUE_2: "true",
  };
}

function listChangedFilesFromGit(root: string, includeIgnored = false, baseOid?: string): string[] {
  const out = git(
    ["-c", "core.quotePath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", ...(includeIgnored ? ['--ignored'] : [])],
    root,
  );
  const files = new Set<string>();
  if (baseOid) for (const file of git(['diff', '--name-only', '--no-renames', '-z', baseOid], root).split('\0').filter(Boolean)) {
    files.add(normalizeWorktreeRelPath(file));
  }
  const entries = out.split('\0');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry || (!includeIgnored && entry.startsWith('!!'))) continue;
    const status = entry.slice(0, 2);
    files.add(normalizeWorktreeRelPath(entry.slice(3)));
    if (status.includes('R') || status.includes('C')) {
      const original = entries[++index];
      if (!original) throw new Error('worktree_git_status_invalid');
      if (status.includes('R')) files.add(normalizeWorktreeRelPath(original));
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
    if (out === 'true') git(['rev-parse', '--show-toplevel'], root);
    return out === "true";
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('GIT_WORKTREE_')) throw error;
    return false;
  }
}

/** Hardened git exec for worktree lifecycle (C4-H): hooks disabled, no locks, no stdin, bounded timeout. */
function git(args: string[], cwd: string): string {
  if (nativeGitWorktreeRoot(cwd)) {
    const reported = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: GIT_EXEC_TIMEOUT_MS, env: hardenedGitEnv() }).trim();
    assertGitNativeRoot(cwd, reported);
  }
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
function assertSupportedGitModes(record: WorktreeRecord, reason: string, baseline = record.baseOid): void {
  if (record.backend !== 'git' || !record.baseOid) return;
  const raw = git(['diff', '--raw', '--no-renames', '-z', baseline!], record.root).split('\0');
  for (let index = 0; index < raw.length; index += 2) {
    const mode = /^:(\d{6}) (\d{6}) /.exec(raw[index]!);
    if (mode && mode[1] !== mode[2] && mode[2] !== '000000' && (mode[1] === '100755' || mode[2] === '100755')) throw new Error(reason);
  }
}

const asyncWorktreeOwners = new Map<string, number>();

function worktreeLockPath(baseRoot: string): string {
  const lockDir = path.join(path.resolve(baseRoot), ".openclaw", "worktrees");
  assertNoSymlinkParentsSync({ rootDir: baseRoot, targetPath: lockDir, requireDirectories: true, messagePrefix: "worktree boundary" });
  mkdirSync(lockDir, { recursive: true });
  if (canonicalPath(lockDir) !== (process.platform === 'win32' ? path.resolve(lockDir).toLowerCase() : path.resolve(lockDir))) {
    throw new Error('worktree_root_redirected');
  }
  const lockPath = path.join(lockDir, ".merge.lock");
  if (pathEntryExists(lockPath)) throw new Error('worktree_legacy_lock_unavailable');
  return lockPath;
}

/** Age never proves a writer has stopped. Reuse the incarnation-aware mutex. */
function withWorktreeLock<T>(baseRoot: string, fn: () => T): T {
  if (asyncWorktreeOwners.has(canonicalWorktreePath(baseRoot))) throw Object.assign(new Error('worktree_merge_busy'), { retryable: true });
  return withTaskLedgerJournalLockSync(worktreeLockPath(baseRoot), fn, { timeoutMs: 3000 });
}

async function withAsyncWorktreeLock<T>(baseRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = worktreeLockPath(baseRoot);
  const key = canonicalWorktreePath(baseRoot);
  asyncWorktreeOwners.set(key, (asyncWorktreeOwners.get(key) ?? 0) + 1);
  try { return await withTaskLedgerJournalLock(lockPath, fn, { timeoutMs: 3000 }); }
  finally {
    const count = asyncWorktreeOwners.get(key)! - 1;
    if (count) asyncWorktreeOwners.set(key, count); else asyncWorktreeOwners.delete(key);
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

/** Shared read-only guard for runtime and Main-owned native worktree removal. */
export function assertWorktreeIndexVisible(root: string): void {
  const hidden = git(['ls-files', '-v', '-z'], root).split('\0').filter(entry => /^[a-zS] /.test(entry));
  if (hidden.length) throw new Error('worktree_cleanup_hidden_index_flags:' + hidden.slice(0, 8).map(entry => entry.slice(2)).join(','));
}

/** Bounded native removal; callers hold their original ownership/admission guard. */
export function removeNativeGitWorktree(repository: string, target: string, force = false): string {
  return git(['worktree', 'remove', ...(force ? ['--force'] : []), '--', target], repository);
}

export function assertCleanupCommitRetained(record: Pick<WorktreeRecord, "backend" | "root" | "baseRoot">): void {
  if (record.backend !== "git") return;
  let head: string;
  let refs: string[];
  try {
    head = git(["rev-parse", "--verify", "HEAD^{commit}"], record.root).trim();
    refs = git(["for-each-ref", `--contains=${head}`, "--format=%(refname)", "refs/"], record.baseRoot)
      .trim().split(/\r?\n/);
  } catch (cause) {
    throw new Error("worktree_cleanup_git_refs_unavailable", { cause });
  }
  // Shared refs survive removal. HEAD/reflogs and worktree-local refs do not prove retention.
  if (!refs.some(isSharedGitRef)) {
    throw new Error(`worktree_cleanup_unreferenced_commit:${head}`);
  }
}

function listDirectoryFiles(root: string, prefix = ""): string[] {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() && !entry.isSymbolicLink() ? listDirectoryFiles(root, relative) : [relative];
  });
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
  assertNoSymlinkParentsSync({ rootDir: baseRoot, targetPath: root, requireDirectories: true, messagePrefix: "worktree boundary" });
  if (input.record.owner?.retention === 'keep') throw new Error('worktree_cleanup_retention_keep');
  if (input.record.backend === 'git') {
    const common = (cwd: string) => canonicalPath(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim());
    if (common(root) !== common(baseRoot)) throw new Error('worktree_cleanup_repository_changed');
  }
  const allowed = new Set((input.record.writeSet ?? []).map((value) => normalizeWorktreeRelPath(value)));
  const files = input.record.backend === 'inprocess' ? listDirectoryFiles(root) : input.changed.files;
  const unexpected = files.filter((value) => !allowed.has(normalizeWorktreeRelPath(value)));
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
/** Recover only baseline facts that the existing Git commit or unchanged target proves. */
function restoreLegacyMergeBaseline(record: WorktreeRecord, files: readonly string[]): void {
  if (record.mergeBaseline && !record.mergeBaseline.restoredFromBase) return;
  const parent = new Map<string, string>(Object.entries(record.mergeBaseline?.parent ?? {}));
  if (record.backend === 'git' && record.baseOid) {
    for (const file of new Set([...files, ...listChangedFilesFromGit(record.root, false, record.baseOid)])) {
      const relative = worktreeRelPathKey(file, record.baseRoot, record.root);
      const entry = git(['ls-tree', '-z', record.baseOid, '--', relative], record.root);
      if (!entry) continue;
      if (!/^100(?:644|755) blob /.test(entry)) throw new Error('worktree_legacy_baseline_unsupported');
      const oid = /^\d+ blob ([0-9a-f]+)/.exec(entry)![1]!;
      const bytes = execFileSync('git', ['cat-file', 'blob', oid], { cwd: record.root, windowsHide: true,
        timeout: GIT_EXEC_TIMEOUT_MS, env: hardenedGitEnv(), maxBuffer: 64 * 1024 * 1024 });
      parent.set(relative, worktreeContentHash(bytes)!);
    }
  } else {
    for (const [file, hash] of captureWorktreeFiles(record.root)) {
      if (worktreeContentHash(readWorktreeFile(record.baseRoot, file)) !== hash) throw new Error('worktree_legacy_baseline_unproven');
      parent.set(file, hash);
    }
  }
  record.mergeBaseline = { parent: Object.fromEntries(parent), worker: Object.fromEntries(parent), restoredFromBase: record.backend === 'git' };
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
  const findRecord = (id: string, generation?: string) => {
    const record = scope(resolved).records.get(safeWorktreeId(id));
    if (!record) throw new Error("worktree_missing");
    if (generation !== undefined && record.generation !== generation) throw new Error("worktree_stale_generation");
    return record;
  };
  const basisFor = (record: WorktreeRecord): CheckoutWriterBasis => {
    assertCurrentWorktree(record);
    return { root: record.root, incarnation: record.registration.rootIdentity!, generation: record.generation };
  };
  const baseBasis = (): CheckoutWriterBasis => ({ root: resolved, incarnation: filesystemInstance(resolved), generation: `base:${filesystemInstance(resolved)}` });
  const checkWriterRecord = (credential: CheckoutWriterCredential, requireReady: boolean) => {
    if (credential.root === canonicalWorktreePath(resolved)) {
      const basis = baseBasis();
      if (credential.generation !== basis.generation || credential.incarnation !== basis.incarnation) throw new Error("worktree_stale_generation");
      return;
    }
    const record = [...scope(resolved).records.values()].find(row => row.generation === credential.generation);
    if (!record || record.generation !== credential.generation || record.registration.rootIdentity !== credential.incarnation) throw new Error("worktree_stale_generation");
    if (requireReady) assertCurrentWorktree(record);
  };

  return {
    backend,
    taskAuthority: expectedProjectRevision => resolveExecutionDomain(resolved, expectedProjectRevision),
    registerTaskAuthority: input => registerExecutionDomain({ ...input, workspaceRoot: resolved }),
    writerBasis: id => id === null ? baseBasis() : basisFor(findRecord(id)),
    claimWriter: (id, generation, owner, requestId, expiresAt) => withWorktreeLock(resolved, () => {
      const basis = id === null ? baseBasis() : basisFor(findRecord(id, generation));
      if (basis.generation !== generation) throw new Error("worktree_stale_generation");
      return claimCheckoutWriter(basis, owner, requestId, expiresAt);
    }),
    beginWrite: (credential, operationId, requestDigest) => withWorktreeLock(resolved, () => {
      checkWriterRecord(credential, true);
      return beginCheckoutWrite(credential, operationId, requestDigest);
    }),
    settleWrite: (credential, operationId, receipt) => withWorktreeLock(resolved, () => {
      checkWriterRecord(credential, false); settleCheckoutWrite(credential, operationId, receipt);
    }),
    drainWriter: credential => withWorktreeLock(resolved, () => {
      checkWriterRecord(credential, false); drainCheckoutWriter(credential);
    }),
    endWriter: (credential, receipt) => withWorktreeLock(resolved, () => {
      checkWriterRecord(credential, false); endCheckoutWriter(credential, receipt);
    }),
    transferWriter: (credential, owner, requestId) => withWorktreeLock(resolved, () => {
      checkWriterRecord(credential, true); return transferCheckoutWriter(credential, owner, requestId);
    }),
    releaseWriter: credential => withWorktreeLock(resolved, () => {
      checkWriterRecord(credential, false); releaseCheckoutWriter(credential);
    }),
    releaseUnusedWriter: credential => withWorktreeLock(resolved, () => {
      checkWriterRecord(credential, false); releaseUnusedCheckoutWriter(credential);
    }),
    writer: id => checkoutWriterSnapshot(id === null ? resolved : findRecord(id).root),
    withFrozenWorktrees: (workers, freeze) => withWorktreeLock(resolved, () =>
      withCheckoutMaintenance([baseBasis(), ...workers.map(worker => basisFor(findRecord(worker.worktreeId, worker.worktreeGeneration)))], "freeze", freeze, () => {
        if (backend === 'git') assertWorktreeIndexVisible(resolved);
        for (const worker of workers) {
          const record = findRecord(worker.worktreeId, worker.worktreeGeneration);
          if (record.backend === 'git') assertWorktreeIndexVisible(record.root);
        }
      })),
    create(id, createOptions) {
      const owner = createOptions?.owner;
      const safeId = safeWorktreeId(id);
      const writeSet = createOptions?.writeSet?.map(normalizeWorktreeRelPath);
      const seedFiles = createOptions?.seedFiles?.map(normalizeWorktreeRelPath);
      for (const relative of seedFiles ?? []) {
        const target = path.join(resolved, relative);
        resolveRootPathSync({ absolutePath: target, rootPath: resolved, boundaryLabel: "worktree seed" });
        if (existsSync(target) && statSync(target).nlink > 1) throw new Error("worktree_seed_hardlink");
      }
      const wtRoot = hardenFsRoot(path.join(rootDir, safeId));
      const requestDigest = createHash("sha256").update(JSON.stringify({
        id, backend, writeSet, seedFiles, owner, installStrategy: createOptions?.installStrategy ?? "none",
      })).digest("hex");

      return withWorktreeLock(resolved, () => {
        const s = scope(resolved);
        const previous = s.records.get(safeId);
        if (previous?.status === "cleaned" && !pathEntryExists(previous.root)) {
          finishRemovedCheckoutCleanup({ root: previous.root, incarnation: previous.registration.rootIdentity!, generation: previous.generation });
        }
        if (createOptions?.operationId && previous?.registration.operationId === createOptions.operationId) {
          if (previous.registration.requestDigest !== requestDigest) throw new Error("worktree_operation_conflict");
          if (previous.registration.phase === "registered" && observeWorktree(previous) === "incomplete") {
            previous.registration.phase = "ready";
            previous.status = "active";
            saveWorktreeRegistryScope(s);
          }
          assertCurrentWorktree(previous);
          return recordSnapshot(previous);
        }
        if (pathEntryExists(wtRoot) || (s.records.has(safeId) && s.records.get(safeId)?.status !== 'cleaned')) {
          throw new Error(`worktree_already_exists:${safeId}`);
        }
        if (owner) {
          const ownedCount = [...s.records.values()].filter(record => record.status !== "cleaned"
            && record.owner?.agentId === owner.agentId && record.owner.sessionKey === owner.sessionKey
            && record.owner.expectedSessionId === owner.expectedSessionId).length;
          const budget = decideLongSessionCoordination({
            policy: resolveLongSessionCoordinationPolicy(),
            usage: { processCount: null, rssKb: null, backgroundTerminals: null, worktreeCount: ownedCount },
            request: { worktrees: 1 },
          });
          if (!budget.allowed) throw new LongSessionCoordinationError(budget);
        }
        const parentBaseline = captureWorktreeFiles(resolved);
        const rec: WorktreeRecord = {
          id: safeId, generation: randomUUID(), root: wtRoot, baseRoot: resolved,
          createdAtMs: Date.now(), status: "creating", writeSet, backend,
          registration: { operationId: createOptions?.operationId ?? randomUUID(), requestDigest, phase: "intent" },
          ...(owner ? { owner: { ...owner, retention: owner.retention ?? "keep" } } : {}),
        };
        s.records.set(safeId, rec);
        saveWorktreeRegistryScope(s);
        // Reserve an empty directory before Git so recovery can distinguish this
        // attempt's native checkout from an unrelated directory at the same path.
        mkdirSync(wtRoot);
        rec.registration.rootIdentity = filesystemInstance(wtRoot);
        rec.registration.phase = "allocated";
        saveWorktreeRegistryScope(s);
        if (backend === "git") {
          git(["worktree", "add", "--detach", path.resolve(wtRoot), "HEAD"], resolved);
          rec.baseOid = git(["rev-parse", "HEAD"], wtRoot).trim();
        }
        rec.registration.nativeIdentity = worktreeNativeIdentity(wtRoot, backend);
        rec.registration.phase = "created";
        saveWorktreeRegistryScope(s);
        seedFilesInto(wtRoot, resolved, seedFiles);
        rec.mergeBaseline = { parent: Object.fromEntries(parentBaseline), worker: Object.fromEntries(captureWorktreeFiles(wtRoot)), workerModes: Object.fromEntries(captureWorktreeModes(wtRoot)) };
        let install: WorktreeInstallResult | undefined;
        if (createOptions?.installStrategy && createOptions.installStrategy !== "none") {
          install = installWorktreeDependencies({
            worktreeRoot: wtRoot,
            baseRoot: resolved,
            strategy: createOptions.installStrategy,
          });
        }

        if (observeWorktree(rec) !== "incomplete") throw new Error("worktree_changed_during_setup");
        const initialWorker = captureWorktreeFiles(rec.root);
        const initialParent = new Map<string, string>();
        for (const file of new Set([...initialWorker.keys(), ...(writeSet ?? [])])) {
          if (initialWorker.get(file) === 'unsupported-file-identity') {
            initialParent.set(file, 'unsupported-file-identity');
            continue;
          }
          const hash = worktreeContentHash(readWorktreeFile(resolved, file));
          if (hash !== null) initialParent.set(file, hash);
        }
        rec.mergeBaseline = { parent: Object.fromEntries(initialParent), worker: Object.fromEntries(initialWorker), workerModes: Object.fromEntries(captureWorktreeModes(rec.root)) };
        rec.registration.phase = "registered";
        saveWorktreeRegistryScope(s);
        rec.registration.phase = "ready";
        rec.status = "active";
        saveWorktreeRegistryScope(s);
        const snapshot = recordSnapshot(rec);
        return install ? Object.assign(snapshot, { install }) : snapshot;
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
    inventory() {
      const records = [...scope(resolved).records.values()];
      const known = new Set(records.map(record => record.id));
      return [
        ...records.map(record => ({ id: record.id, root: record.root, availability: observeWorktree(record), record: recordSnapshot(record) })),
        ...listWorktreeDirs(resolved).filter(id => !known.has(id)).map(id => ({ id, root: path.join(rootDir, id), availability: "unowned" as const })),
      ];
    },
    inspectIsolation(id, generation) {
      try {
        return withWorktreeLock(resolved, (): WorktreeIsolationInspection => {
          const rec = scope(resolved).records.get(safeWorktreeId(id));
          if (!rec || rec.status === 'cleaned') return { status: 'unverified', reason: 'missing-worktree' };
          if (rec.generation !== generation) return { status: 'unverified', reason: 'stale-generation' };
          assertCurrentWorktree(rec);
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
    listChangedFiles(id, expectedGeneration) {
      const rec = scope(resolved).records.get(safeWorktreeId(id));
      if (!rec) return { files: [], source: "unavailable" as const };
      if (expectedGeneration !== undefined && rec.generation !== expectedGeneration) throw new Error("worktree_stale_generation");
      if (observeWorktree(rec) !== "ready") return { files: [], source: "unavailable" as const };
      if (rec.backend === "git") {
        try {
          return { files: listChangedFilesFromGit(rec.root, false, rec.baseOid), source: "git-status" as const };
        } catch {
          return { files: [], source: "unavailable" as const };
        }
      }
      if (rec.mergeBaseline) {
        return { files: changedWorktreeFiles(new Map(Object.entries(rec.mergeBaseline.worker)), captureWorktreeFiles(rec.root)), source: "filesystem-snapshot" as const };
      }
      return {
        files: [...(rec.writeSet ?? [])],
        source: rec.writeSet?.length ? "declared-writeSet" as const : "unavailable" as const,
      };
    },
    enqueueMerge(item) {
      return withWorktreeLock(resolved, () => {
        const s = scope(resolved);
        const id = safeWorktreeId(item.worktreeId);
        const record = s.records.get(id);
        const pathKey = (file: string) => worktreeRelPathKey(file, resolved, record?.root);
        if (item.worktreeGeneration !== undefined && record?.generation !== item.worktreeGeneration) throw new Error("worktree_stale_generation");
        if (record && s.queue.some(entry => entry.worktreeId === id && entry.reason === 'merge_outcome_unknown')) {
          const states = [recoverPreparedCheckoutMaintenance(resolved), recoverPreparedCheckoutMaintenance(record.root)];
          if (states.every(state => state?.state === 'released' && state.owner.kind === 'maintenance' && state.owner.operation === 'merge'
            && state.operations.length && state.operations.every(operation => operation.state === 'settled' && operation.receipt?.outcome === 'not-applied' && operation.effectPrepared === false))
            && states[0]!.owner.kind === 'maintenance' && states[1]!.owner.kind === 'maintenance'
            && states[0]!.owner.operationId === states[1]!.owner.operationId) {
            s.queue = s.queue.filter(entry => entry.worktreeId !== id || entry.reason !== 'merge_outcome_unknown');
            saveWorktreeRegistryScope(s);
          }
        }
        if (s.queue.some(entry => entry.worktreeId === id && (entry.reason === "merge_outcome_unknown" || entry.recoveryRequired))) {
          throw new Error("worktree_merge_reconciliation_required");
        }
        const changedFiles = [...new Map(item.changedFiles.map(normalizeWorktreeRelPath).map(file => [pathKey(file), file])).values()].sort();
        const sameFiles = (entry: MergeQueueItem) => entry.worktreeGeneration === record?.generation
          && JSON.stringify(entry.changedFiles.map(pathKey).sort()) === JSON.stringify(changedFiles.map(pathKey).sort());
        // Terminal outcomes retain their original generation independently of checkout lifecycle.
        if (record?.mergeResult?.status === 'merged' && sameFiles(record.mergeResult)) {
          const hashes = new Map(Object.entries(record.mergeResult.hashes ?? {}).map(([file, hash]) => [pathKey(file), hash]));
          if (item.expectedPostimages) {
            const expected = new Map(Object.entries(item.expectedPostimages).map(([file, hash]) => [pathKey(file), hash]));
            if (expected.size !== hashes.size || [...expected].some(([file, hash]) => !hashes.has(file) || hashes.get(file) !== hash)) {
              throw new Error('worktree_frozen_candidate_changed');
            }
          }
          if (record.status !== 'cleaned' && changedFiles.some(file => worktreeContentHash(readWorktreeFile(record.root, file)) !== hashes.get(pathKey(file)))) {
            throw new Error("worktree_merge_input_changed");
          }
          return structuredClone(record.mergeResult);
        }
        if (record?.mergeResult?.status === 'merged') throw new Error('worktree_merge_request_conflict');
        if (record && (!record.mergeBaseline || record.mergeBaseline.restoredFromBase)) {
          restoreLegacyMergeBaseline(record, changedFiles);
          saveWorktreeRegistryScope(s);
        }
        if (record?.backend === 'git') {
          const observed = new Set(listChangedFilesFromGit(record.root, false, record.baseOid).map(pathKey));
          if (changedFiles.some(file => !observed.has(pathKey(file)))) throw new Error('worktree_merge_paths_not_observed');
        }
        const pending = s.queue.find(entry => entry.worktreeId === id && entry.status === "pending" && sameFiles(entry));
        if (pending) {
          if (item.expectedPostimages) {
            if (pending.expectedPostimages && JSON.stringify(pending.expectedPostimages) !== JSON.stringify(item.expectedPostimages)) throw new Error('worktree_frozen_candidate_changed');
            pending.expectedPostimages = structuredClone(item.expectedPostimages);
            saveWorktreeRegistryScope(s);
          }
          return structuredClone(pending);
        }
        const entry: MergeQueueItem = {
          worktreeId: id,
          worktreeGeneration: record?.generation,
          changedFiles,
          status: item.status ?? "pending",
          review: item.review,
          reason: item.reason,
          ...(item.expectedPostimages ? { expectedPostimages: structuredClone(item.expectedPostimages) } : {}),
        };
        s.queue.push(entry);
        saveWorktreeRegistryScope(s);
        return structuredClone(entry);
      });
    },
    async processMergeQueue(factStore, processOptions) {
      const policy = processOptions?.conflictPolicy ?? defaultConflictPolicy;
      const selectedWorktreeIds = processOptions?.worktreeIds ? new Set(processOptions.worktreeIds) : undefined;
      return withAsyncWorktreeLock(resolved, async () => {
        const s = scope(resolved);
        const results: MergeQueueItem[] = [];
        for (const item of s.queue) {
          if (selectedWorktreeIds && !selectedWorktreeIds.has(item.worktreeId)) continue;
          if (item.status !== "pending") { results.push(item); continue; }
          const rec = s.records.get(item.worktreeId);
          if (!rec || rec.generation !== item.worktreeGeneration || observeWorktree(rec) !== "ready") {
            applyConflictPolicy(item, undefined,
              !rec ? "missing_worktree" : rec.generation !== item.worktreeGeneration ? "stale-generation" : "worktree_not_ready", policy);
            results.push(item); continue;
          }
          if (rec.mergeResult?.status === 'merged') {
            const pathKey = (file: string) => worktreeRelPathKey(file, resolved, rec.root);
            if (JSON.stringify(item.changedFiles.map(pathKey).sort()) === JSON.stringify(rec.mergeResult.changedFiles.map(pathKey).sort())) {
              Object.assign(item, structuredClone(rec.mergeResult));
            } else applyConflictPolicy(item, undefined, 'worktree_merge_request_conflict', policy);
            results.push(item); continue;
          }
          const conflictWith = results.find(other => other.status === "merged" && other.changedFiles.some(file => item.changedFiles.includes(file)));
          if (conflictWith) {
            applyConflictPolicy(item, rec, `overlap_with_${conflictWith.worktreeId}`, policy);
            results.push(item); continue;
          }
          if (factStore) {
            try {
              const review = reviewDiff(factStore, resolved, { changedFiles: item.changedFiles });
              item.review = { relatedTests: review.relatedTests ?? [], riskLevel: review.riskLevel };
            } catch { /* Related-test hints do not authorize filesystem effects. */ }
          }
          const pathKey = (file: string) => worktreeRelPathKey(file, resolved, rec.root);
          const assertCurrent = () => {
            processOptions?.assertParentCurrent?.();
            assertCurrentWorktree(rec);
            if (rec.backend === 'git') assertWorktreeIndexVisible(rec.root);
            if (rec.baseOid && git(["rev-parse", "HEAD"], resolved).trim() !== rec.baseOid) throw new Error("worktree_base_head_changed");
            if (!rec.mergeBaseline) throw new Error("worktree_baseline_unavailable");
            assertSupportedGitModes(rec, 'worktree_merge_mode_unsupported');
            const changes = rec.backend === 'git' ? listChangedFilesFromGit(rec.root, false, rec.baseOid)
              : changedWorktreeFiles(new Map(Object.entries(rec.mergeBaseline.worker)), captureWorktreeFiles(rec.root));
            const requested = new Set(item.changedFiles.map(pathKey));
            const observed = new Set(changes.map(pathKey));
            if (changes.some(file => !requested.has(pathKey(file)))) throw new Error("worker_changes_not_in_merge_request");
            if (rec.backend === 'git' && item.changedFiles.some(file => !observed.has(pathKey(file)))) throw new Error('worktree_merge_paths_not_observed');
          };
          let validationFailed = false;
          try {
          await withAsyncCheckoutMaintenance<MergeQueueItem>([baseBasis(), basisFor(rec)], "merge", async (admit) => {
            item.status = 'conflict'; item.reason = 'merge_outcome_unknown';
            saveWorktreeRegistryScope(s);
            const baseline = rec.mergeBaseline!;
            const applied = await applyWorktreeFiles({ baseRoot: resolved, workerRoot: rec.root,
              sessionKey: rec.owner?.sessionKey ?? `worktree:${rec.id}`,
              baseline: { parent: new Map(Object.entries(baseline.parent)), worker: new Map(Object.entries(baseline.worker)) },
              files: item.changedFiles, assertCurrent, expectedPostimages: item.expectedPostimages,
              beforeApply: (journalRef, hashes) => {
                item.journalRef = journalRef; item.hashes = hashes;
                saveWorktreeRegistryScope(s);
              }, beforeEffect: admit });
            item.journalRef = applied.journalRef ?? item.journalRef;
            item.recoveryRequired = applied.recoveryRequired;
            item.hashes = applied.hashes;
            if (!applied.success) applyConflictPolicy(item, rec, applied.reason ?? "merge_failed", policy);
            else { item.status = "merged"; delete item.reason; codingObservability.recordMergeOutcome(false); }
            // Keep the journal and postimages durable before returning the writer.
            // Until its terminal receipt settles, the queue still requires reconciliation.
            const terminal = structuredClone(item);
            item.status = 'conflict'; item.reason = 'merge_outcome_unknown';
            saveWorktreeRegistryScope(s);
            if (applied.recoveryRequired) {
              throw new Error("worktree_merge_reconciliation_required");
            }
            Object.assign(item, terminal);
            if (!terminal.reason) delete item.reason;
            return terminal;
          }, () => {
            try { assertCurrent(); } catch (error) { validationFailed = true; throw error; }
          }, terminal => terminal.status === 'merged' ? 'completed' : 'not-applied', terminal => {
            rec.status = terminal.status === 'merged' ? 'merged' : 'conflict';
            rec.mergeResult = structuredClone(terminal);
            saveWorktreeRegistryScope(s);
          }, true);
          } catch (error) {
            if (!validationFailed) throw error;
            applyConflictPolicy(item, undefined, `preflight:${error instanceof Error ? error.message : String(error)}`, policy);
          }
          results.push(item);
        }
        s.queue = s.queue.filter(item => item.reason === "merge_outcome_unknown" || item.recoveryRequired || !results.includes(item));
        saveWorktreeRegistryScope(s);
        return results.map(item => structuredClone(item));
      });
    },
    cleanup(id, cleanupOptions) {
      withWorktreeLock(resolved, () => {
        const s = scope(resolved);
        const rec = s.records.get(safeWorktreeId(id));
        if (!rec) return;
        if (cleanupOptions?.expectedGeneration !== undefined && rec.generation !== cleanupOptions.expectedGeneration) throw new Error("worktree_stale_generation");
        if (rec.status === "cleaned") {
          if (!pathEntryExists(rec.root)) {
            finishRemovedCheckoutCleanup({ root: rec.root, incarnation: rec.registration.rootIdentity!, generation: rec.generation });
            finishExecutionTaskWorktreeCleanup(rec.taskCleanup);
          }
          return;
        }
        if (s.queue.some(item => item.worktreeId === rec.id && (item.status === "pending" || item.reason === "merge_outcome_unknown"))) {
          throw new Error("worktree_merge_reconciliation_required");
        }
        if (rec.status === "cleaning" && observeWorktree(rec) === "missing") {
          finishRemovedCheckoutCleanup({ root: rec.root, incarnation: rec.registration.rootIdentity!, generation: rec.generation });
          finishExecutionTaskWorktreeCleanup(rec.taskCleanup);
          rec.status = "cleaned";
          saveWorktreeRegistryScope(s);
          return;
        }
        if (rec.status === "cleaning") {
          if (observeWorktree(rec) !== "incomplete") throw new Error("worktree_cleanup_identity_changed");
        } else assertCurrentWorktree(rec);
        if (rec.backend === 'git') git(['rev-parse', '--show-toplevel'], resolved);
        return withExecutionTaskWorktreeCleanup(rec.root, resolved, `worktree-cleanup:${rec.generation}`, taskCleanup => {
        const cleanupInventory = () => {
          if (rec.backend === 'git') {
            const ignored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], rec.root).split('\0').filter(Boolean);
            if (ignored.length) throw new Error('worktree_cleanup_ignored_content_present:' + ignored.slice(0, 8).join(','));
            assertWorktreeIndexVisible(rec.root);
          }
          const observed = captureWorktreeFiles(rec.root, rec.backend === 'inprocess');
          const changed = rec.backend === 'git' ? { files: listChangedFilesFromGit(rec.root), source: 'git-status' as const }
            : { files: changedWorktreeFiles(new Map(Object.entries(rec.mergeBaseline?.worker ?? {})), observed), source: 'filesystem-snapshot' as const };
          const ownership = requireCleanupAuthorization({ rootDir, baseRoot: resolved, record: rec,
            authorization: cleanupOptions?.authorization, changed });
          if (rec.backend === 'inprocess') {
            for (const file of new Set([...observed.keys(), ...changed.files])) {
              if (worktreeContentHash(readWorktreeFile(resolved, file)) !== worktreeContentHash(readWorktreeFile(rec.root, file))) {
                throw new Error('worktree_cleanup_unretained_content:' + file);
              }
            }
          }
          const beforeModes = rec.mergeBaseline?.workerModes;
          const retainedModes = captureWorktreeModes(resolved);
          for (const [file, mode] of captureWorktreeModes(rec.root)) {
            if (!file) {
              if (mode !== (beforeModes?.[''] ?? retainedModes.get(''))) throw new Error('worktree_cleanup_unretained_mode:<worktree-root>');
              continue;
            }
            if (rec.backend === 'inprocess') {
              if (retainedModes.get(file) !== mode) throw new Error('worktree_cleanup_unretained_mode:' + file);
              continue;
            }
            if (beforeModes?.[file] === mode || retainedModes.get(file) === mode) continue;
            // Git retains ordinary committed files; dirty files were refused above.
            if (rec.backend === 'git' && beforeModes?.[file] === undefined
              && mode === ((process.platform === 'win32' || (file && lstatSync(path.join(rec.root, file)).isFile()) ? 0o666 : 0o777) & ~process.umask())) continue;
            if (rec.backend === 'git' && file && lstatSync(path.join(rec.root, file)).isFile()) {
              const before = beforeModes?.[file] ?? (0o666 & ~process.umask());
              const committed = /^([0-7]{6}) /.exec(git(['ls-tree', 'HEAD', '--', file], rec.root));
              if ((mode & ~0o111) === (before & ~0o111) && committed
                && Boolean(mode & 0o111) === (committed[1] === '100755')) continue;
            }
            throw new Error('worktree_cleanup_unretained_mode:' + file);
          }
          return ownership;
        };
        const ownership = cleanupInventory();
        const beforeCleanupStatus = rec.status;
        if (taskCleanup) { rec.taskCleanup = taskCleanup; saveWorktreeRegistryScope(s); }
        const cleanupResult = withCheckoutMaintenance([{
          root: rec.root, incarnation: rec.registration.rootIdentity!, generation: rec.generation,
        }], "cleanup", () => {
          try {
            if (filesystemInstance(rec.root) !== rec.registration.rootIdentity
              || worktreeNativeIdentity(rec.root, rec.backend) !== rec.registration.nativeIdentity) throw new Error('worktree_cleanup_identity_changed');
            cleanupInventory();
            assertCleanupCommitRetained(rec);
          } catch (error) {
            rec.status = beforeCleanupStatus; saveWorktreeRegistryScope(s); return { error };
          }
          if (rec.backend === "git") {
            // Git rechecks live modifications at removal; a refusal retains the checkout.
            const beforeRemoval = captureWorktreeFiles(rec.root, true);
            try { removeNativeGitWorktree(resolved, ownership.root, true); }
            catch (error) {
              const failure = error as { status?: number; stderr?: Buffer | string };
              let retainedDirtyRefusal = false;
              if (failure.status === 128 && /contains modified or untracked files/i.test(String(failure.stderr ?? ''))) {
                try {
                  const after = captureWorktreeFiles(rec.root, true);
                  retainedDirtyRefusal = filesystemInstance(rec.root) === rec.registration.rootIdentity
                    && worktreeNativeIdentity(rec.root, rec.backend) === rec.registration.nativeIdentity
                    && [...beforeRemoval.keys()].every(file => after.has(file))
                    && listChangedFilesFromGit(rec.root).length > 0;
                } catch { /* An unavailable observation retains the unknown outcome. */ }
              }
              if (!retainedDirtyRefusal) throw error;
              rec.status = beforeCleanupStatus;
              saveWorktreeRegistryScope(s);
              return { error };
            }
          } else {
            removePathWithRetries(ownership.root);
          }
          if (existsSync(ownership.root)) {
            throw new Error('worktree_cleanup_survivor');
          }
          rec.status = "cleaned";
          saveWorktreeRegistryScope(s);
          return { error: undefined };
        }, () => {
          assertCleanupCommitRetained(rec);
          rec.status = "cleaning";
          saveWorktreeRegistryScope(s);
        }, result => result.error ? 'not-applied' : 'completed');
        if (cleanupResult.error) throw cleanupResult.error;
        });
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
          this.cleanup(record.id, { expectedGeneration: record.generation });
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

/** Use the recorded managed owner when present; a selected independent root uses the same writer namespace. */
export function resolveExecutionCheckout(root: string): {
  service: WorktreeService; baseRoot: string; worktreeId: string | null; basis: CheckoutWriterBasis;
} {
  if (nativeGitWorktreeRoot(root)) git(['rev-parse', '--show-toplevel'], root);
  const registered = findManagedWorktreeByRoot(root);
  const baseRoot = registered?.baseRoot ?? root;
  const service = createWorktreeService(baseRoot);
  const worktreeId = registered?.record.id ?? null;
  const basis = service.writerBasis(worktreeId);
  if (canonicalWorktreePath(basis.root) !== canonicalWorktreePath(root)) throw new Error("worktree_execution_root_mismatch");
  return { service, baseRoot, worktreeId, basis };
}

/** Consume only durable Task owner receipts; unknown effects retain checkout exclusion. */
export function reconcileTaskCheckoutWrites(checkout: { baseRoot: string; worktreeId: string | null; credential: CheckoutWriterCredential }): void {
  const service = createWorktreeService(checkout.baseRoot);
  const state = service.writer(checkout.worktreeId);
  if (!state || state.epoch !== checkout.credential.epoch || state.token !== checkout.credential.token
    || state.owner.kind !== 'run' || !state.owner.task) return;
  const sessionKey = state.owner.run.scope.sessionKey;
  if (!sessionKey) throw new Error('TASK_CHECKOUT_EXECUTION_IDENTITY_REQUIRED');
  const store = openExecutionTaskStore(state.root);
  try {
    if (store.domain.id !== state.owner.task.authorityId) throw new Error('TASK_CHECKOUT_AUTHORITY_MISMATCH');
    const task: TaskCredential = { taskNodeId: state.owner.task.taskNodeId as TaskCredential['taskNodeId'],
      sessionKey, generation: state.owner.sessionGeneration, epoch: state.owner.task.epoch };
    for (const operation of state.operations.filter(row => row.state !== 'settled')) {
      let receipt;
      try { receipt = store.operation(task, operation.id); } catch { continue; }
      if (receipt.state === 'completed' || receipt.state === 'reconciled') service.settleWrite(checkout.credential,
        operation.id, { outcome: receipt.receipt?.outcome === 'not_applied' ? 'not-applied' : 'completed',
          ownerReceipt: receipt.receipt?.id ?? `task-operation:${operation.id}:${receipt.epoch}:${receipt.state}` });
    }
  } finally { store.close(); }
}

export function __resetWorktreeRegistry(): void {
  closeOpenClawStateDatabaseForTest();
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
