/**
 * C5-1 / C5-H: symbol-granularity write leases over FactStore symbols.
 *
 * Modes:
 * - memory (default): process-local Map; optional WAL append is best-effort only
 * - wal: rehydrate under the existing process-incarnation mutex; expiry fences
 *   a lease, and only confirmed owner exit/replacement permits reclamation.
 *
 * C5-H multi-process hardening: exclusive lock with stale recovery, atomic WAL append under lock,
 * cross-process contention tests. Defaults remain enabled=false and mode=memory.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import path from "node:path";
import type { SymbolLeaseMode } from "../coding-runtime-flags.js";
import { withTaskLedgerJournalLockSync, taskLedgerLockPath } from "../../../../shared/task-ledger-journal-lock.js";
import { readTaskLedgerProcessIncarnation, taskLedgerOwnIncarnation } from "../../../../shared/task-ledger-process.js";

/** C5-H capability: multi-process WAL path is hardened; defaults stay off/memory. */
export const MULTI_PROCESS_WAL_HARDENED = true as const;

export type SymbolLease = {
  symbolKey: string;
  holderId: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  filePath?: string;
  /** Missing fields denote a legacy owner whose lifetime cannot be inferred. */
  leaseId?: string;
  owner?: { pid: number; incarnation: string };
  fencedAtMs?: number;
};

export type LeaseAcquireResult =
  | { ok: true; lease: SymbolLease }
  | { ok: false; reason: "held" | "expired_race" | "fenced" | "owner_unknown" | "lock_busy"; holderId?: string; expiresAtMs?: number };

type LeaseStore = {
  leases: Map<string, SymbolLease>;
  walPath?: string;
  lockPath?: string;
  mode: SymbolLeaseMode;
  initialized: boolean;
};

const stores = new Map<string, LeaseStore>();

function storeKey(workspaceRoot: string, mode: SymbolLeaseMode): string {
  return `${path.resolve(workspaceRoot)}::${mode}`;
}

function ensureWalPaths(workspaceRoot: string): { walPath: string; lockPath: string } {
  const walDir = path.join(path.resolve(workspaceRoot), ".openclaw", "leases");
  mkdirSync(walDir, { recursive: true });
  return {
    walPath: path.join(walDir, "symbol-leases.wal.jsonl"),
    lockPath: path.join(walDir, "symbol-leases.lock"),
  };
}

function storeFor(workspaceRoot: string, mode: SymbolLeaseMode = "memory"): LeaseStore {
  const key = storeKey(workspaceRoot, mode);
  let s = stores.get(key);
  if (!s) {
    s = { leases: new Map(), mode, initialized: false };
    if (mode === "wal" || mode === "memory") {
      try {
        const paths = ensureWalPaths(workspaceRoot);
        s.walPath = paths.walPath;
        s.lockPath = paths.lockPath;
        s.initialized = existsSync(s.walPath) || existsSync(taskLedgerLockPath(s.walPath));
      } catch (error) {
        if (mode === "wal") throw error;
      }
    }
    if (mode === "memory" && s.walPath && existsSync(s.walPath)) hydrateFromWal(s);
    stores.set(key, s);
  }
  return s;
}

function hydrateFromWal(s: LeaseStore): void {
  if (!s.walPath || !existsSync(s.walPath)) {
    if (s.initialized || s.leases.size) throw new Error("symbol_lease_owner_journal_missing");
    s.leases.clear();
    return;
  }
  s.leases.clear();
  for (const line of readFileSync(s.walPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    {
      const row = JSON.parse(line) as { op: string; lease?: SymbolLease; symbolKey?: string; holderId?: string; leaseId?: string };
      if ((row.op === "acquire" || row.op === "fence") && row.lease) {
        if (!row.lease.symbolKey || !row.lease.holderId || !Number.isFinite(row.lease.acquiredAtMs) || !Number.isFinite(row.lease.expiresAtMs)) throw new Error("symbol_lease_owner_journal_invalid");
        if (row.lease.owner && (!Number.isSafeInteger(row.lease.owner.pid) || row.lease.owner.pid < 1
          || typeof row.lease.owner.incarnation !== "string" || !row.lease.owner.incarnation)) throw new Error("symbol_lease_owner_journal_invalid");
        s.leases.set(row.lease.symbolKey, row.lease);
      } else if (row.op === "release" && row.symbolKey) {
        const held = s.leases.get(row.symbolKey);
        if (held && held.holderId === row.holderId && held.leaseId === row.leaseId) s.leases.delete(row.symbolKey);
      } else {
        throw new Error("symbol_lease_owner_journal_invalid");
      }
    }
  }
  s.initialized = true;
}

/**
 * Reuse the incarnation-aware local mutex; age never deletes a live lock.
 * Acquisition fails immediately on mutex contention. Release retains the
 * existing bounded wait so a transient contender cannot silently lose cleanup.
 */
function withLock(s: LeaseStore, fn: () => void, timeoutMs = 3000): void {
  if (s.mode !== "wal") {
    fn();
    return;
  }
  if (!s.walPath || !s.lockPath) throw new Error("symbol_lease_owner_journal_unavailable");
  if (existsSync(s.lockPath)) throw new Error("symbol_lease_legacy_lock_unavailable");
  withTaskLedgerJournalLockSync(s.walPath, fn, { timeoutMs });
}

/** Durable in WAL mode; memory mode retains only its declared process-local guarantee. */
function appendWal(s: LeaseStore, row: unknown): void {
  if (!s.walPath) {
    if (s.mode === "wal") throw new Error("symbol_lease_owner_journal_unavailable");
    return;
  }
  try {
    const line = `${JSON.stringify(row)}\n`;
    const fd = openSync(s.walPath, "a");
    try {
      writeFileSync(fd, line, "utf8");
      fsyncSync(fd);
      s.initialized = true;
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (s.mode === "wal") throw error;
  }
}

function ownerState(lease: SymbolLease): "live" | "gone" | "unknown" {
  const owner = lease.owner;
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.incarnation !== "string" || !owner.incarnation) return "unknown";
  try { process.kill(owner.pid, 0); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown"; }
  const incarnation = owner.pid === process.pid ? taskLedgerOwnIncarnation() : readTaskLedgerProcessIncarnation(owner.pid);
  return incarnation === null ? "unknown" : incarnation === owner.incarnation ? "live" : "gone";
}

export function symbolLeaseKey(params: { filePath?: string; symbolName: string }): string {
  const file = (params.filePath ?? "").replace(/\\/g, "/");
  return `${file}::${params.symbolName}`;
}

export function acquireSymbolLease(params: {
  workspaceRoot: string;
  holderId: string;
  symbolName: string;
  filePath?: string;
  ttlMs?: number;
  nowMs?: number;
  mode?: SymbolLeaseMode;
}): LeaseAcquireResult {
  const now = params.nowMs ?? Date.now();
  const ttl = params.ttlMs ?? 30_000;
  if (!params.workspaceRoot.trim() || !params.holderId.trim() || !params.symbolName.trim()) throw new TypeError("symbol_lease_identity_required");
  if (!Number.isFinite(now) || !Number.isFinite(ttl) || ttl <= 0 || !Number.isFinite(now + ttl)) throw new RangeError("symbol_lease_invalid_expiry");
  const mode = params.mode ?? "memory";
  const s = storeFor(params.workspaceRoot, mode);
  const key = symbolLeaseKey({ filePath: params.filePath, symbolName: params.symbolName });
  let result: LeaseAcquireResult = { ok: false, reason: "held" };

  const run = () => {
    if (mode === "wal") {
      hydrateFromWal(s);
    }
    const existing = s.leases.get(key);
    if (existing) {
      if (existing.expiresAtMs > now && existing.fencedAtMs === undefined) {
        result = { ok: false, reason: "held", holderId: existing.holderId, expiresAtMs: existing.expiresAtMs };
        return;
      }
      // Publish the fence before attempting recovery. An active or unknown
      // old execution retains the resource even after its nominal TTL.
      if (existing.fencedAtMs === undefined) {
        existing.fencedAtMs = now;
        appendWal(s, { op: "fence", lease: existing, at: now });
      }
      const state = ownerState(existing);
      if (state !== "gone") {
        result = { ok: false, reason: state === "unknown" ? "owner_unknown" : "fenced", holderId: existing.holderId, expiresAtMs: existing.expiresAtMs };
        return;
      }
      appendWal(s, { op: "release", symbolKey: key, holderId: existing.holderId, leaseId: existing.leaseId, at: now, reason: "owner-exit-or-incarnation-replaced" });
      s.leases.delete(key);
    }
    const lease: SymbolLease = {
      symbolKey: key,
      holderId: params.holderId,
      acquiredAtMs: now,
      expiresAtMs: now + ttl,
      filePath: params.filePath?.replace(/\\/g, "/"),
      leaseId: randomUUID(),
      owner: { pid: process.pid, incarnation: taskLedgerOwnIncarnation() },
    };
    appendWal(s, { op: "acquire", lease, at: now });
    s.leases.set(key, lease);
    result = { ok: true, lease };
  };

  try { withLock(s, run, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "LOCK_TIMEOUT") throw error;
    result = { ok: false, reason: "lock_busy" };
  }
  return result;
}

export function releaseSymbolLease(params: {
  workspaceRoot: string;
  holderId: string;
  symbolName: string;
  filePath?: string;
  mode?: SymbolLeaseMode;
  leaseId?: string;
}): boolean {
  const mode = params.mode ?? "memory";
  const s = storeFor(params.workspaceRoot, mode);
  const key = symbolLeaseKey({ filePath: params.filePath, symbolName: params.symbolName });
  let ok = false;
  const run = () => {
    if (mode === "wal") {
      hydrateFromWal(s);
    }
    const existing = s.leases.get(key);
    if (!existing) {
      ok = false;
      return;
    }
    if (!params.leaseId || existing.leaseId !== params.leaseId || existing.holderId !== params.holderId
      || existing.owner?.pid !== process.pid || existing.owner.incarnation !== taskLedgerOwnIncarnation()) {
      ok = false;
      return;
    }
    appendWal(s, { op: "release", symbolKey: key, holderId: params.holderId, leaseId: existing.leaseId, at: Date.now() });
    s.leases.delete(key);
    ok = true;
  };
  withLock(s, run);
  return ok;
}

/** Force re-read WAL into a fresh process-local view (test helper). */
export function rehydrateSymbolLeases(workspaceRoot: string, mode: SymbolLeaseMode = "wal"): void {
  const s = storeFor(workspaceRoot, mode);
  withLock(s, () => hydrateFromWal(s));
}

export function __resetSymbolLeases(): void {
  stores.clear();
}

/** Compact WAL for tests / maintenance (best-effort). */
export function compactSymbolLeaseWal(workspaceRoot: string): void {
  const s = storeFor(workspaceRoot, "wal");
  const walPath = s.walPath;
  if (!walPath) return;
  withLock(s, () => {
    hydrateFromWal(s);
    const lines: string[] = [];
    for (const lease of s.leases.values()) {
      lines.push(JSON.stringify({ op: "acquire", lease, at: lease.acquiredAtMs }));
    }
    const tmp = `${walPath}.tmp`;
    writeFileSync(tmp, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
    try {
      renameSync(tmp, walPath);
    } catch {
      writeFileSync(walPath, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
      try {
        unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
  });
}
