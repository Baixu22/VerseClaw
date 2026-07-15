import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../../context-engine/coding-observability.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import {
  checkFileSyntax,
  formatSyntaxCheckFailed,
} from "../post-write-parse-check.js";
import { wrapToolWithWriteSideEffects } from "../write-side-effects.js";

function makeWriteTool(execute: AnyAgentTool["execute"]): AnyAgentTool {
  return {
    name: "write",
    label: "Write",
    description: "write",
    parameters: {},
    execute,
  } as AnyAgentTool;
}

describe("post-write-parse-check (C2-9)", () => {
  let repoRoot: string;

  beforeEach(() => {
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "syntax-check-"));
  });

  afterEach(() => {
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("detects broken TypeScript brackets", () => {
    const bad = "export function f( { return 1;\n";
    writeFileSync(path.join(repoRoot, "bad.ts"), bad, "utf8");
    const result = checkFileSyntax({
      workspaceRoot: repoRoot,
      relPath: "bad.ts",
      content: bad,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
      expect(formatSyntaxCheckFailed(result.message)).toMatch(/^failed\(/);
    }
  });

  it("accepts valid TypeScript", () => {
    const good = "export function f() { return 1; }\n";
    const result = checkFileSyntax({
      workspaceRoot: repoRoot,
      relPath: "good.ts",
      content: good,
    });
    expect(result.ok).toBe(true);
  });

  it("unknown language is silent (no false positive)", () => {
    const result = checkFileSyntax({
      workspaceRoot: repoRoot,
      relPath: "notes.xyz",
      content: "((( not code",
    });
    expect(result.ok).toBe(true);
  });

  it("write wrapper attaches syntax_check on bad content", async () => {
    const bad = "export function f( { return 1;\n";
    writeFileSync(path.join(repoRoot, "broken.ts"), bad, "utf8");
    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: { path: "broken.ts" },
    }));
    const wrapped = wrapToolWithWriteSideEffects(base, {
      workspaceRoot: repoRoot,
      parseOnWriteEnabled: false,
      syntaxCheckEnabled: true,
    });
    const result = await wrapped.execute("1", {
      path: "broken.ts",
      content: bad,
    });
    const details = result.details as { syntax_check?: string };
    expect(details.syntax_check).toMatch(/^failed\(/);
    expect(codingObservability.snapshot().syntaxCheckHits).toBeGreaterThanOrEqual(1);
  });

  it("normal write has no syntax_check field", async () => {
    const good = "export const x = 1;\n";
    writeFileSync(path.join(repoRoot, "ok.ts"), good, "utf8");
    const base = makeWriteTool(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    const wrapped = wrapToolWithWriteSideEffects(base, {
      workspaceRoot: repoRoot,
      parseOnWriteEnabled: false,
      syntaxCheckEnabled: true,
    });
    const result = await wrapped.execute("1", { path: "ok.ts", content: good });
    const details = result.details as { syntax_check?: string };
    expect(details.syntax_check).toBeUndefined();
  });
});
