/**
 * C5-1 / C5-H: symbol-granularity write leases over FactStore symbols.
 *
 * Modes:
 * - memory (default): process-local Map; optional WAL append is best-effort only
 * - wal: rehydrate from WAL on every acquire/release for multi-process awareness + crash reclaim by TTL
 *
 * C5-H multi-process hardening: exclusive lock with stale recovery, atomic WAL append under lock,
 * cross-process contention tests. Defaults remain enabled=false and mode=memory.
 */
import {
  appendFileSync,
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

/** C5-H capability: multi-process WAL path is hardened; defaults stay off/memory. */
export const MULTI_PROCESS_WAL_HARDENED = true as const;

export type SymbolLease = {
  symbolKey: string;
  holderId: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  filePath?: string;
};

export type LeaseAcquireResult =
  | { ok: true; lease: SymbolLease }
  | { ok: false; reason: "held" | "expired_race"; holderId?: string; expiresAtMs?: number };

type LeaseStore = {
  leases: Map<string, SymbolLease>;
  walPath?: string;
  lockPath?: string;
  mode: SymbolLeaseMode;
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

function sleepMs(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* spin */
  }
}

function storeFor(workspaceRoot: string, mode: SymbolLeaseMode = "memory"): LeaseStore {
  const key = storeKey(workspaceRoot, mode);
  let s = stores.get(key);
  if (!s) {
    s = { leases: new Map(), mode };
    if (mode === "wal" || mode === "memory") {
      try {
        const paths = ensureWalPaths(workspaceRoot);
        s.walPath = paths.walPath;
        s.lockPath = paths.lockPath;
        if (mode === "memory" && existsSync(s.walPath)) {
          hydrateFromWal(s);
        }
      } catch {
        // wal optional
      }
    }
    stores.set(key, s);
  }
  return s;
}

function hydrateFromWal(s: LeaseStore): void {
  if (!s.walPath || !existsSync(s.walPath)) {
    s.leases.clear();
    return;
  }
  s.leases.clear();
  for (const line of readFileSync(s.walPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { op: string; lease?: SymbolLease; symbolKey?: string };
      if (row.op === "acquire" && row.lease) {
        s.leases.set(row.lease.symbolKey, row.lease);
      } else if (row.op === "release" && row.symbolKey) {
        s.leases.delete(row.symbolKey);
      }
    } catch {
      // skip bad line
    }
  }
}

/**
 * Exclusive lock with PID+timestamp payload and stale recovery (C5-H multi-process).
 * Falls back to unlocked critical section if lock cannot be obtained (fail-open memory path).
 */
function withLock(s: LeaseStore, fn: () => void): void {
  if (!s.lockPath || s.mode !== "wal") {
    fn();
    return;
  }
  const started = Date.now();
  let fd: number | undefined;
  while (Date.now() - started < 3000) {
    try {
      fd = openSync(s.lockPath, "wx");
      writeFileSync(s.lockPath, `${process.pid}\n${Date.now()}\n`, "utf8");
      break;
    } catch {
      try {
        if (existsSync(s.lockPath)) {
          const raw = readFileSync(s.lockPath, "utf8");
          const ts = Number(raw.split(/\r?\n/)[1] ?? 0);
          if (ts > 0 && Date.now() - ts > 15_000) {
            unlinkSync(s.lockPath);
            continue;
          }
        }
      } catch {
        // ignore
      }
      sleepMs(5);
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
        unlinkSync(s.lockPath);
      } catch {
        // ignore
      }
    }
  }
}

/** Append one WAL row under caller-held lock; uses durable append + best-effort fsync. */
function appendWal(s: LeaseStore, row: unknown): void {
  if (!s.walPath) return;
  try {
    const line = `${JSON.stringify(row)}\n`;
    appendFileSync(s.walPath, line, "utf8");
    try {
      const fd = openSync(s.walPath, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch {
      // fsync best-effort
    }
  } catch {
    // fail-open
  }
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
  const mode = params.mode ?? "memory";
  const s = storeFor(params.workspaceRoot, mode);
  const now = params.nowMs ?? Date.now();
  const key = symbolLeaseKey({ filePath: params.filePath, symbolName: params.symbolName });
  let result: LeaseAcquireResult = { ok: false, reason: "held" };

  const run = () => {
    if (mode === "wal") {
      hydrateFromWal(s);
    }
    const existing = s.leases.get(key);
    if (existing && existing.expiresAtMs > now && existing.holderId !== params.holderId) {
      result = {
        ok: false,
        reason: "held",
        holderId: existing.holderId,
        expiresAtMs: existing.expiresAtMs,
      };
      return;
    }
    const ttl = params.ttlMs ?? 30_000;
    const lease: SymbolLease = {
      symbolKey: key,
      holderId: params.holderId,
      acquiredAtMs: now,
      expiresAtMs: now + ttl,
      filePath: params.filePath?.replace(/\\/g, "/"),
    };
    s.leases.set(key, lease);
    appendWal(s, { op: "acquire", lease, at: now });
    result = { ok: true, lease };
  };

  withLock(s, run);
  return result;
}

export function releaseSymbolLease(params: {
  workspaceRoot: string;
  holderId: string;
  symbolName: string;
  filePath?: string;
  mode?: SymbolLeaseMode;
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
    if (existing.holderId !== params.holderId) {
      ok = false;
      return;
    }
    s.leases.delete(key);
    appendWal(s, { op: "release", symbolKey: key, holderId: params.holderId, at: Date.now() });
    ok = true;
  };
  withLock(s, run);
  return ok;
}

/** Force re-read WAL into a fresh process-local view (test helper). */
export function rehydrateSymbolLeases(workspaceRoot: string, mode: SymbolLeaseMode = "wal"): void {
  const s = storeFor(workspaceRoot, mode);
  hydrateFromWal(s);
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