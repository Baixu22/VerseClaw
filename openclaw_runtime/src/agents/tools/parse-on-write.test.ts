import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../../context-engine/coding-observability.js";
import {
  __resetWorkspaceFactServiceRegistry,
  resolveWorkspaceFactService,
} from "../../context-engine/factstore/workspace-fact-service.js";
import { closeAllFactStores } from "../../context-engine/factstore/store.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import { wrapToolWithWriteSideEffects } from "../write-side-effects.js";

function makeTool(name: string, execute: AnyAgentTool["execute"]): AnyAgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: {},
    execute,
  } as AnyAgentTool;
}

describe("parse-on-write (C2-1)", () => {
  let repoRoot: string;

  beforeEach(() => {
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "parse-write-"));
    mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    writeFileSync(path.join(repoRoot, "src", "a.ts"), "export const a = 1;\n");
  });

  afterEach(() => {
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("successful write increments pendingTouchedCount", async () => {
    const service = resolveWorkspaceFactService(repoRoot);
    const base = makeTool("write", async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    const wrapped = wrapToolWithWriteSideEffects(base, {
      workspaceRoot: repoRoot,
      materializer: service.materializer,
      parseOnWriteEnabled: true,
      syntaxCheckEnabled: false,
    });
    expect(service.materializer.pendingTouchedCount()).toBe(0);
    await wrapped.execute("1", { path: "src/a.ts", content: "export const a = 2;\n" });
    expect(service.materializer.pendingTouchedCount()).toBe(1);
    expect(codingObservability.snapshot().parseOnWriteHits).toBe(1);
  });

  it("failed write does not touch", async () => {
    const service = resolveWorkspaceFactService(repoRoot);
    const base = makeTool("write", async () => {
      throw new Error("write failed");
    });
    const wrapped = wrapToolWithWriteSideEffects(base, {
      workspaceRoot: repoRoot,
      materializer: service.materializer,
      parseOnWriteEnabled: true,
      syntaxCheckEnabled: false,
    });
    await expect(wrapped.execute("1", { path: "src/a.ts", content: "x" })).rejects.toThrow(
      /write failed/i,
    );
    expect(service.materializer.pendingTouchedCount()).toBe(0);
  });
});
