// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CLAWX_VERSESHELL_FACADE } from "../../shared/verseshell/facade";
import {
  buildReadonlyFacadeCacheKey,
  createVerseShellReadonlyFacadeTools,
  resolveReadonlyWorkspacePath,
} from "../../openclaw_runtime/src/agents/verseshell/readonly-facade";

const ENABLED_FLAGS = {
  verifiedRuntime: true,
  typedAci: true,
  facade: true,
  governedExec: true,
  artifactResults: true,
};

describe("VerseShell P2 read-only facade contract", () => {
  it("preserves the stable four-operation model facade order", () => {
    expect(CLAWX_VERSESHELL_FACADE.map((entry) => entry.name)).toEqual([
      "read_file",
      "search_content",
      "run_command",
      "result_query",
    ]);
  });

  it("does not materialize tools until every readiness flag is explicit", () => {
    expect(createVerseShellReadonlyFacadeTools({ cwd: process.cwd(), config: {} })).toBeNull();
    expect(createVerseShellReadonlyFacadeTools({
      cwd: process.cwd(),
      config: { runtime: { verseShellFoundation: ENABLED_FLAGS } },
    })?.map((tool) => tool.name)).toEqual(["read_file", "search_content", "result_query"]);
  });

  it("keeps paths and cache identity inside the workspace contract", () => {
    expect(resolveReadonlyWorkspacePath(process.cwd(), "src/index.ts")).toBe("src/index.ts");
    expect(() => resolveReadonlyWorkspacePath(process.cwd(), "../outside")).toThrow();
    const first = buildReadonlyFacadeCacheKey({
      workspace: process.cwd(),
      revision: "one",
      policyDigest: "sha256:one",
      op: "file.view",
      args: { path: "src/index.ts" },
    });
    const second = buildReadonlyFacadeCacheKey({
      workspace: process.cwd(),
      revision: "two",
      policyDigest: "sha256:one",
      op: "file.view",
      args: { path: "src/index.ts" },
    });
    expect(first).not.toBe(second);
  });
});
