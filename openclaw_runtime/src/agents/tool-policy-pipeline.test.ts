/**
 * Fail-loud catalog-drift diagnostics for profile-driven tool filtering.
 */
import { describe, expect, it } from "vitest";
import { stubTool } from "./test-helpers/fast-tool-stubs.js";
import type { AnyAgentTool } from "./tools/common.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
  resetToolPolicyWarningCacheForTest,
} from "./tool-policy-pipeline.js";

const DRIFT_MARKER = "no entry in CORE_TOOL_DEFINITIONS";

function runProfilePipeline(toolNames: string[], allow: string[]) {
  const warnings: string[] = [];
  resetToolPolicyWarningCacheForTest();
  const result = applyToolPolicyPipeline({
    tools: toolNames.map((name) => stubTool(name) as unknown as AnyAgentTool),
    toolMeta: () => undefined,
    warn: (message) => warnings.push(message),
    steps: buildDefaultToolPolicyPipelineSteps({
      profilePolicy: { allow },
      profile: "coding",
    }),
  });
  return { result, warnings };
}

describe("applyToolPolicyPipeline profile drift diagnostics", () => {
  it("keeps constructed cataloged tools listed in the coding profile", () => {
    const { result } = runProfilePipeline(["pdf", "read"], ["read", "pdf"]);
    expect(result.map((tool) => tool.name).sort()).toEqual(["pdf", "read"]);
  });

  it("warns when a profile drops a constructed core tool with no catalog entry", () => {
    const { result, warnings } = runProfilePipeline(["future_core_tool"], ["read"]);
    expect(result).toEqual([]);
    expect(warnings.some((message) => message.includes(DRIFT_MARKER))).toBe(true);
    expect(warnings.some((message) => message.includes('"future_core_tool"'))).toBe(true);
  });

  it("does not drift-warn for cataloged tools with intentional empty profiles", () => {
    const { warnings } = runProfilePipeline(["browser"], ["read"]);
    expect(warnings.some((message) => message.includes(DRIFT_MARKER))).toBe(false);
  });

  it("does not drift-warn for plugin-owned tools", () => {
    const warnings: string[] = [];
    resetToolPolicyWarningCacheForTest();
    applyToolPolicyPipeline({
      tools: [stubTool("plugin_tool") as unknown as AnyAgentTool],
      toolMeta: () => ({ pluginId: "demo" }),
      warn: (message) => warnings.push(message),
      steps: buildDefaultToolPolicyPipelineSteps({
        profilePolicy: { allow: ["read"] },
        profile: "coding",
      }),
    });
    expect(warnings.some((message) => message.includes(DRIFT_MARKER))).toBe(false);
  });

  it("does not drift-warn when the tool survives the profile", () => {
    const { warnings } = runProfilePipeline(["read"], ["read"]);
    expect(warnings.some((message) => message.includes(DRIFT_MARKER))).toBe(false);
  });
});
