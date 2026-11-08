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

  it("accepts only complete persisted recovery admission identities", () => {
    const admission = {
      idempotencyKey: "recovery-run",
      ownerId: "original-run",
      attempts: 1,
      ownerEpoch: "epoch",
    };
    expect(Value.Check(AgentParamsSchema, { ...minimalValid, recoveryAdmission: admission })).toBe(
      true,
    );
    expect(
      Value.Check(AgentParamsSchema, {
        ...minimalValid,
        recoveryAdmission: { ...admission, attempts: 0 },
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentParamsSchema, {
        ...minimalValid,
        recoveryAdmission: { ...admission, ownerEpoch: "" },
      }),
    ).toBe(false);
  });
});
