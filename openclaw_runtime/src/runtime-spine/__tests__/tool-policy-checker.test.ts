import { describe, expect, it } from "vitest";
import { ToolPolicyChecker } from "../checkers/tool-policy-checker.js";
import type { GateCheckRequest } from "../types.js";

function request(payload: unknown): GateCheckRequest {
  return {
    gateType: "pre_execution",
    entityId: "tool-entity",
    entityType: "tool_invocation",
    source: {
      sourceId: "runtime.tool_policy.test",
      sourceType: "tool",
      stage: "pre_execution",
    },
    payload,
  };
}

describe("ToolPolicyChecker", () => {
  it("supports only pre_execution gates and reports allowlist decisions diagnostically", async () => {
    const checker = new ToolPolicyChecker();

    expect(checker.supportedGateTypes).toEqual(["pre_execution"]);
    expect(checker.gateTypes).toEqual(["pre_execution"]);

    expect(
      checker.check(request({ toolName: "read", policies: [{ allow: ["read"], deny: ["write"] }] })),
    ).toMatchObject({
      checkerId: "tool-policy-checker",
      passed: true,
      metadata: {
        diagnosticOnly: true,
        legacyGuardUnaffected: true,
        supportedGateTypes: ["pre_execution"],
      },
    });

    expect(
      checker.check(request({ toolName: "write", policies: [{ allow: ["read"], deny: ["write"] }] })),
    ).toMatchObject({
      checkerId: "tool-policy-checker",
      passed: false,
      message: "Tool policy would deny this tool invocation.",
      metadata: {
        diagnosticOnly: true,
        legacyGuardUnaffected: true,
        normalizedToolName: "write",
      },
    });
  });
});
