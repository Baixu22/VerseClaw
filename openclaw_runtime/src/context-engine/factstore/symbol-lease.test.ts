import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  __resetSymbolLeases,
  acquireSymbolLease,
  rehydrateSymbolLeases,
  releaseSymbolLease,
  MULTI_PROCESS_WAL_HARDENED,
  compactSymbolLeaseWal,
} from "./symbol-lease.js";

describe("symbol-lease (C5-1 + C5-H)", () => {
  let root: string;
  beforeEach(() => {
    __resetSymbolLeases();
    root = mkdtempSync(path.join(tmpdir(), "lease-"));
  });
  afterEach(() => {
    __resetSymbolLeases();
    rmSync(root, { recursive: true, force: true });
  });

  it("second holder blocked until owner release (memory)", () => {
    const a = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "w1",
      symbolName: "login",
      filePath: "src/a.ts",
      ttlMs: 60_000,
      nowMs: 1000,
      mode: "memory",
    });
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error("initial lease refused");
    const b = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "w2",
      symbolName: "login",
      filePath: "src/a.ts",
      ttlMs: 60_000,
      nowMs: 1001,
      mode: "memory",
    });
    expect(b.ok).toBe(false);
    expect(
      releaseSymbolLease({
        workspaceRoot: root,
        holderId: "w1",
        symbolName: "login",
        filePath: "src/a.ts",
        mode: "memory",
        leaseId: a.lease.leaseId,
      }),
    ).toBe(true);
    const c = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "w2",
      symbolName: "login",
      filePath: "src/a.ts",
      nowMs: 1002,
      mode: "memory",
    });
    expect(c.ok).toBe(true);
  });

  it("C5-H wal: expiry fences a live holder instead of admitting a second writer", () => {
    const a = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "w1",
      symbolName: "login",
      filePath: "src/a.ts",
      ttlMs: 100,
      nowMs: 1000,
      mode: "wal",
    });
    expect(a.ok).toBe(true);
    const b = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "w2",
      symbolName: "login",
      filePath: "src/a.ts",
      ttlMs: 100,
      nowMs: 1000 + 101,
      mode: "wal",
    });
    expect(b).toMatchObject({ ok: false, reason: "fenced", holderId: "w1" });
    const wal = readFileSync(path.join(root, ".openclaw", "leases", "symbol-leases.wal.jsonl"), "utf8");
    expect(wal).toContain('"op":"fence"');
  });

  it("C5-H wal: rehydrate from WAL blocks second logical process (crash recovery path)", () => {
    const a = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "proc-a",
      symbolName: "Foo",
      filePath: "src/x.ts",
      ttlMs: 60_000,
      nowMs: 5000,
      mode: "wal",
    });
    expect(a.ok).toBe(true);
    // Simulate fresh process memory by resetting in-memory maps then rehydrating WAL.
    __resetSymbolLeases();
    rehydrateSymbolLeases(root, "wal");
    const b = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "proc-b",
      symbolName: "Foo",
      filePath: "src/x.ts",
      ttlMs: 60_000,
      nowMs: 5001,
      mode: "wal",
    });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.holderId).toBe("proc-a");
    }
  });

  it("C5-H wal: release then second process can acquire", () => {
    const first = acquireSymbolLease({
        workspaceRoot: root,
        holderId: "p1",
        symbolName: "Bar",
        filePath: "src/y.ts",
        ttlMs: 60_000,
        nowMs: 7000,
        mode: "wal",
      });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("initial lease refused");
    expect(
      releaseSymbolLease({
        workspaceRoot: root,
        holderId: "p1",
        symbolName: "Bar",
        filePath: "src/y.ts",
        mode: "wal",
        leaseId: first.lease.leaseId,
      }),
    ).toBe(true);
    __resetSymbolLeases();
    const next = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "p2",
      symbolName: "Bar",
      filePath: "src/y.ts",
      ttlMs: 60_000,
      nowMs: 7001,
      mode: "wal",
    });
    expect(next.ok).toBe(true);
  });

  it("exports MULTI_PROCESS_WAL_HARDENED capability (defaults unchanged elsewhere)", () => {
    expect(MULTI_PROCESS_WAL_HARDENED).toBe(true);
  });

  it("C5-H wal: concurrent acquire under lock yields single winner", () => {
    const holders = ["p-a", "p-b", "p-c", "p-d"];
    const results = holders.map((holderId) =>
      acquireSymbolLease({
        workspaceRoot: root,
        holderId,
        symbolName: "race",
        filePath: "src/race.ts",
        ttlMs: 60_000,
        nowMs: 9000,
        mode: "wal",
      }),
    );
    const winners = results.filter((r) => r.ok);
    expect(winners.length).toBe(1);
    expect(results.filter((r) => !r.ok).length).toBe(holders.length - 1);
  });

  it("C5-H wal: compact keeps active acquire rows", () => {
    expect(
      acquireSymbolLease({
        workspaceRoot: root,
        holderId: "compact-1",
        symbolName: "Z",
        filePath: "src/z.ts",
        ttlMs: 60_000,
        nowMs: 11_000,
        mode: "wal",
      }).ok,
    ).toBe(true);
    compactSymbolLeaseWal(root);
    __resetSymbolLeases();
    rehydrateSymbolLeases(root, "wal");
    const blocked = acquireSymbolLease({
      workspaceRoot: root,
      holderId: "compact-2",
      symbolName: "Z",
      filePath: "src/z.ts",
      ttlMs: 60_000,
      nowMs: 11_001,
      mode: "wal",
    });
    expect(blocked.ok).toBe(false);
  });

  it("does not free an expired live lease when the process-local view is cleared", () => {
    const first = acquireSymbolLease({ workspaceRoot: root, holderId: "live", symbolName: "x", ttlMs: 1, nowMs: 1, mode: "wal" });
    expect(first.ok).toBe(true);
    __resetSymbolLeases();
    expect(acquireSymbolLease({ workspaceRoot: root, holderId: "other", symbolName: "x", nowMs: 3, mode: "wal" }))
      .toMatchObject({ ok: false, reason: "fenced" });
  });

  it("requires the issued nonce and cannot use an old release against a replacement", () => {
    const first = acquireSymbolLease({ workspaceRoot: root, holderId: "same", symbolName: "x", mode: "wal" });
    if (!first.ok) throw new Error("initial lease refused");
    expect(releaseSymbolLease({ workspaceRoot: root, holderId: "same", symbolName: "x", mode: "wal" })).toBe(false);
    expect(releaseSymbolLease({ workspaceRoot: root, holderId: "same", symbolName: "x", mode: "wal", leaseId: first.lease.leaseId })).toBe(true);
    const replacement = acquireSymbolLease({ workspaceRoot: root, holderId: "same", symbolName: "x", mode: "wal" });
    if (!replacement.ok) throw new Error("replacement refused");
    expect(replacement.lease.leaseId).not.toBe(first.lease.leaseId);
    expect(releaseSymbolLease({ workspaceRoot: root, holderId: "same", symbolName: "x", mode: "wal", leaseId: first.lease.leaseId })).toBe(false);
    expect(acquireSymbolLease({ workspaceRoot: root, holderId: "other", symbolName: "x", mode: "wal" }).ok).toBe(false);
  });

  it("keeps a legacy expired lease with no provable process owner unavailable", () => {
    const first = acquireSymbolLease({ workspaceRoot: root, holderId: "first", symbolName: "x", mode: "wal" });
    if (!first.ok) throw new Error("initial lease refused");
    const wal = path.join(root, ".openclaw", "leases", "symbol-leases.wal.jsonl");
    appendFileSync(wal, JSON.stringify({ op: "acquire", lease: { symbolKey: "::x", holderId: "legacy", acquiredAtMs: 1, expiresAtMs: 2 } }) + "\n");
    expect(acquireSymbolLease({ workspaceRoot: root, holderId: "new", symbolName: "x", mode: "wal", nowMs: 3 }))
      .toMatchObject({ ok: false, reason: "owner_unknown" });
  });

  it("refuses admission when the owner journal contains a torn record", () => {
    acquireSymbolLease({ workspaceRoot: root, holderId: "first", symbolName: "x", mode: "wal" });
    appendFileSync(path.join(root, ".openclaw", "leases", "symbol-leases.wal.jsonl"), '{"op":');
    expect(() => acquireSymbolLease({ workspaceRoot: root, holderId: "new", symbolName: "other", mode: "wal" })).toThrow();
  });

  it("does not turn a missing previously initialized journal into empty capacity", () => {
    acquireSymbolLease({ workspaceRoot: root, holderId: "first", symbolName: "x", mode: "wal" });
    rmSync(path.join(root, ".openclaw", "leases", "symbol-leases.wal.jsonl"));
    __resetSymbolLeases();
    expect(() => acquireSymbolLease({ workspaceRoot: root, holderId: "new", symbolName: "x", mode: "wal" }))
      .toThrow("symbol_lease_owner_journal_missing");
  });
});
