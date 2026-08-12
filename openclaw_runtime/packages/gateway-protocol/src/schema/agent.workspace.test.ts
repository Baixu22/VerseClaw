import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { AgentParamsSchema } from "./agent.js";

describe("AgentParamsSchema workspaceDir", () => {
  const minimalValid = {
    message: "inspect the selected project",
    idempotencyKey: "agent-workspace-test",
  };

  it("accepts a trusted backend workspace directory", () => {
    expect(
      Value.Check(AgentParamsSchema, {
        ...minimalValid,
        workspaceDir: "C:/projects/verse-claw",
      }),
    ).toBe(true);
  });

  it("rejects an empty workspace directory", () => {
    expect(
      Value.Check(AgentParamsSchema, {
        ...minimalValid,
        workspaceDir: "",
      }),
    ).toBe(false);
  });

  it("still rejects unknown fields at the protocol boundary", () => {
    expect(
      Value.Check(AgentParamsSchema, {
        ...minimalValid,
        workspaceDir: "C:/projects/verse-claw",
        rogueField: true,
      }),
    ).toBe(false);
  });
});
