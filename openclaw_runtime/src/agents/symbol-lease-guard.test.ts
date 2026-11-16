/**
 * C5-1: unit tests for write-tool lease wrap (default-off + mutual exclusion).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetSymbolLeases, acquireSymbolLease, releaseSymbolLease } from "../context-engine/factstore/symbol-lease.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import {
  FILE_LEVEL_SYMBOL,
  SymbolLeaseHeldError,
  resolveWriteTargetsFromArgs,
  wrapToolWithSymbolLease,
} from "./symbol-lease-guard.js";

function fakeTool(name: string, execute?: AnyAgentTool["execute"]): AnyAgentTool {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute:
      execute ??
      (async () => ({
        content: [{ type: "text", text: "ok" }],
        details: {},
      })),
  } as unknown as AnyAgentTool;
}

describe("symbol-lease-guard (C5-1 wiring)", () => {
  let root: string;
  beforeEach(() => {
    __resetSymbolLeases();
    root = mkdtempSync(path.join(tmpdir(), "lease-guard-"));
  });
  afterEach(() => {
    __resetSymbolLeases();
    rmSync(root, { recursive: true, force: true });
  });

  it("is a no-op when enabled is not true", async () => {
    const tool = wrapToolWithSymbolLease(fakeTool("write"), {
      workspaceRoot: root,
      holderId: "s1",
      enabled: false,
    });
    const result = await tool.execute("1", { path: "a.ts", content: "x" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "ok" });
  });

  it("blocks concurrent holders on the same path symbol when enabled", async () => {
    let releaseInner: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseInner = resolve;
    });
    const slow = wrapToolWithSymbolLease(
      fakeTool("write", async () => {
        await blocker;
        return { content: [{ type: "text", text: "slow" }], details: {} };
      }),
      { workspaceRoot: root, holderId: "s1", enabled: true, ttlMs: 60_000, nowMs: 1000 },
    );
    const fast = wrapToolWithSymbolLease(fakeTool("write"), {
      workspaceRoot: root,
      holderId: "s2",
      enabled: true,
      ttlMs: 60_000,
      nowMs: 1001,
    });

    const p1 = slow.execute("1", { path: "src/a.ts", content: "one" });
    await new Promise((r) => setTimeout(r, 10));
    await expect(fast.execute("2", { path: "src/a.ts", content: "two" })).rejects.toBeInstanceOf(
      SymbolLeaseHeldError,
    );
    releaseInner?.();
    await p1;
  });

  it("resolves apply_patch paths to file-level symbols", () => {
    const targets = resolveWriteTargetsFromArgs("apply_patch", {
      input: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** End Patch\n",
    });
    expect(targets).toEqual([{ filePath: "src/a.ts", symbolName: FILE_LEVEL_SYMBOL }]);
  });

  it("orders owner keys and compensates the first lease when a later resource is held", async () => {
    const held = acquireSymbolLease({ workspaceRoot: root, holderId: "other", symbolName: FILE_LEVEL_SYMBOL, filePath: "z.ts" });
    if (!held.ok) throw new Error("initial lease refused");
    const tool = wrapToolWithSymbolLease(fakeTool("apply_patch"), { workspaceRoot: root, holderId: "request", enabled: true });
    try {
      await expect(tool.execute("ordered", { input: "*** Begin Patch\n*** Update File: z.ts\n@@\n-a\n+b\n*** Update File: a.ts\n@@\n-a\n+b\n*** End Patch\n" }))
        .rejects.toBeInstanceOf(SymbolLeaseHeldError);
      const rows = readFileSync(path.join(root, ".openclaw/leases/symbol-leases.wal.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(rows.filter(row => row.op === "acquire").map(row => row.lease.symbolKey)).toEqual(["z.ts::__file__", "a.ts::__file__"]);
      expect(rows.at(-1)).toMatchObject({ op: "release", symbolKey: "a.ts::__file__" });
      expect(acquireSymbolLease({ workspaceRoot: root, holderId: "next", symbolName: FILE_LEVEL_SYMBOL, filePath: "a.ts" }).ok).toBe(true);
    } finally { releaseSymbolLease({ workspaceRoot: root, holderId: "other", symbolName: FILE_LEVEL_SYMBOL, filePath: "z.ts", leaseId: held.lease.leaseId }); }
  });

  it("does not acquire a lease or execute an already cancelled tool request", async () => {
    const abort = new AbortController();
    abort.abort();
    let executed = false;
    const tool = wrapToolWithSymbolLease(fakeTool("write", async () => {
      executed = true;
      return { content: [], details: {} };
    }), { workspaceRoot: root, holderId: "cancelled", enabled: true });
    await expect(tool.execute("cancelled", { path: "a.ts" }, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(executed).toBe(false);
    expect(acquireSymbolLease({ workspaceRoot: root, holderId: "next", symbolName: FILE_LEVEL_SYMBOL, filePath: "a.ts" }).ok).toBe(true);
  });
});
