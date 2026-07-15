/**
 * C5-1: unit tests for write-tool lease wrap (default-off + mutual exclusion).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetSymbolLeases } from "../context-engine/factstore/symbol-lease.js";
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
});