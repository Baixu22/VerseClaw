import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../../context-engine/coding-observability.js";
import {
  attachDiagToResult,
  diagnoseFileWithTimeout,
  diagnoseTypeScriptFile,
} from "../post-write-diag.js";

describe("post-write-diag (C2-5)", () => {
  let repoRoot: string;
  beforeEach(() => {
    codingObservability.reset();
    repoRoot = mkdtempSync(path.join(tmpdir(), "diag-"));
  });
  afterEach(() => {
    codingObservability.reset();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("flags bad type assignment", () => {
    const bad = "const x: number = 'not-a-number';\n";
    writeFileSync(path.join(repoRoot, "bad.ts"), bad, "utf8");
    const findings = diagnoseTypeScriptFile({
      workspaceRoot: repoRoot,
      relPath: "bad.ts",
      content: bad,
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /number|incompatible|not-a-number|string/i.test(f.message))).toBe(
      true,
    );
  });

  it("timeout <=0 returns silent empty findings", async () => {
    const result = await diagnoseFileWithTimeout({
      workspaceRoot: repoRoot,
      relPath: "a.ts",
      content: "export const a = 1;\n",
      timeoutMs: 0,
    });
    expect(result.timedOut).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("attachDiagToResult records metric", () => {
    const result = attachDiagToResult(
      { content: [{ type: "text", text: "ok" }], details: {} },
      [{ file: "a.ts", message: "type error", code: 2322 }],
    );
    expect((result.details as { diag?: unknown[] }).diag?.length).toBe(1);
    expect(codingObservability.snapshot().diagHits).toBe(1);
  });
});
