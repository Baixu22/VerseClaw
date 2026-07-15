import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../../context-engine/coding-observability.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import {
  hashFileContent,
  recordSessionReadHash,
  __resetSessionReadHashes,
} from "../session-read-hashes.js";
import { StaleWriteError, wrapToolWithStaleWriteGuard } from "../stale-write-guard.js";

function makeWriteTool(execute: AnyAgentTool["execute"]): AnyAgentTool {
  return {
    name: "write",
    label: "Write",
    description: "write",
    parameters: {},
    execute,
  } as AnyAgentTool;
}

describe("stale-write-guard (C2-2)", () => {
  let repoRoot: string;
  const sessionId = "sess-stale";

  beforeEach(() => {
    __resetSessionReadHashes();
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "stale-write-"));
    writeFileSync(path.join(repoRoot, "a.ts"), "export const a = 1;\n", "utf8");
  });

  afterEach(() => {
    __resetSessionReadHashes();
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("blocks read -> external change -> write", async () => {
    const original = "export const a = 1;\n";
    recordSessionReadHash(sessionId, "a.ts", hashFileContent(original));
    writeFileSync(path.join(repoRoot, "a.ts"), "export const a = 2;\n", "utf8");

    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "written" }],
      details: {},
    }));
    const wrapped = wrapToolWithStaleWriteGuard(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });
    await expect(
      wrapped.execute("1", { path: "a.ts", content: "export const a = 3;\n" }),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(codingObservability.snapshot().staleBlocks).toBe(1);
  });

  it("allows read -> write without external change", async () => {
    const original = "export const a = 1;\n";
    recordSessionReadHash(sessionId, "a.ts", hashFileContent(original));
    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "written" }],
      details: {},
    }));
    const wrapped = wrapToolWithStaleWriteGuard(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });
    const result = await wrapped.execute("1", {
      path: "a.ts",
      content: "export const a = 3;\n",
    });
    expect(result.content[0]).toMatchObject({ type: "text", text: "written" });
    expect(codingObservability.snapshot().staleAllowances).toBe(1);
  });

  it("does not block writes for unread files", async () => {
    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    const wrapped = wrapToolWithStaleWriteGuard(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: true,
    });
    await wrapped.execute("1", { path: "a.ts", content: "x" });
    expect(codingObservability.snapshot().staleBlocks).toBe(0);
  });

  it("flag off allows all writes", async () => {
    recordSessionReadHash(sessionId, "a.ts", hashFileContent("export const a = 1;\n"));
    writeFileSync(path.join(repoRoot, "a.ts"), "changed", "utf8");
    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    const wrapped = wrapToolWithStaleWriteGuard(base, {
      workspaceRoot: repoRoot,
      sessionId,
      enabled: false,
    });
    await wrapped.execute("1", { path: "a.ts", content: "x" });
    expect(codingObservability.snapshot().staleBlocks).toBe(0);
  });
});
