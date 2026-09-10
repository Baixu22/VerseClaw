import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readWorkspaceFile = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("context read-only recall contract", () => {
  it("documents the bounded DCS owner-store lifecycle exception", () => {
    const rule = readWorkspaceFile("harness/specs/rules/context-family-boundary.md");
    const task = readWorkspaceFile("harness/specs/tasks/context-readonly-recall-surface.md");

    expect(rule).toContain("context_read(include_archived=true)");
    expect(rule).toContain("existing DCS BlockStore authority");
    expect(rule).toContain("ToolRiskLevel=readonly");
    expect(rule).toContain("not proof that");
    expect(task).toContain("existing DCS BlockStore owner API");
    expect(task).toContain("not evidence that `ToolRiskLevel=readonly`");
  });

  it("keeps the implementation's default risk label and explicit recall path visible", () => {
    const source = readWorkspaceFile(
      "openclaw_runtime/src/agents/tools/context-agent-tools.ts",
    );

    expect(source).toContain('risk: "readonly"');
    expect(source).toContain("includeArchived");
    expect(source).toContain("existing BlockStore authority");
  });
});
