import { describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../agent-tools.types.js";
import { wrapToolWithSoftWriteGates } from "../write-soft-gates.js";

function makeWrite(execute: AnyAgentTool["execute"]): AnyAgentTool {
  return {
    name: "write",
    label: "Write",
    description: "write",
    parameters: {},
    execute,
  } as AnyAgentTool;
}

describe("write soft gates (C2-4/C2-7)", () => {
  it("attaches edit_readiness soft warning when not_enough_context", async () => {
    const base = makeWrite(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    const wrapped = wrapToolWithSoftWriteGates(base, {
      workspaceRoot: process.cwd(),
      editReadiness: "not_enough_context",
      impactPrecheckEnabled: false,
    });
    const result = await wrapped.execute("1", { path: "a.ts", content: "x" });
    const details = result.details as { edit_readiness?: string };
    expect(details.edit_readiness).toMatch(/not_enough_context/);
  });

  it("silent when readiness ready", async () => {
    const base = makeWrite(async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }));
    const wrapped = wrapToolWithSoftWriteGates(base, {
      workspaceRoot: process.cwd(),
      editReadiness: "ready",
      impactPrecheckEnabled: false,
    });
    const result = await wrapped.execute("1", { path: "a.ts", content: "x" });
    const details = result.details as { edit_readiness?: string };
    expect(details.edit_readiness).toBeUndefined();
  });
});
