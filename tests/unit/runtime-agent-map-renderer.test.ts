import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBudgetedAgentMapResult,
  isAgentMapResult,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildAgentMapFixtureRequest,
  buildClawxLikeAgentMapFixtureRequest,
  readAgentMapFixtureFiles,
  readClawxLikeAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

describe("AgentMap readonly renderer", () => {
  it("renders complete file-grouped symbol blocks with stable fixture output", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildAgentMapFixtureRequest({
        mentionedSymbols: ["sendMessage"],
        tokenBudget: 760,
      }),
      files: readAgentMapFixtureFiles(),
      contextLines: 0,
    });
    const expected = readFileSync(
      join(process.cwd(), "tests", "fixtures", "agent-map", "expected", "diagnostic-map.txt"),
      "utf8",
    ).replace(/\r\n/g, "\n").trimEnd();

    expect(isAgentMapResult(result)).toBe(true);
    expect(result.readonly).toBe(true);
    expect(result.content).toBe(expected);
    expect(result.excludedFiles).toContainEqual(expect.objectContaining({
      file: "src/renderer/Composer.tsx",
      included: false,
      reason: "promptPresentFile",
    }));
    expect(result.content).toContain("## src/shared/host-api.ts");
    expect(result.content).toContain("@@ symbol sendMessage (function)");
  });

  it("renders a stable ClawX-like cross-layer fixture snapshot", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildClawxLikeAgentMapFixtureRequest({
        mentionedSymbols: ["dispatchRuntimeMessage"],
        tokenBudget: 1000,
      }),
      files: readClawxLikeAgentMapFixtureFiles(),
      contextLines: 0,
    });
    const expected = readFileSync(
      join(
        process.cwd(),
        "tests",
        "fixtures",
        "agent-map",
        "expected",
        "clawx-like-diagnostic-map.txt",
      ),
      "utf8",
    ).replace(/\r\n/g, "\n").trimEnd();

    expect(isAgentMapResult(result)).toBe(true);
    expect(result.content).toBe(expected);
    expect(result.content).toContain("## openclaw_runtime/src/runtime-core/chat-dispatch.ts");
    expect(result.content).toContain("@@ symbol dispatchRuntimeMessage (function)");
  });
});
