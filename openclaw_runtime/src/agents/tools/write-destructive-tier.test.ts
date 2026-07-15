import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codingObservability } from "../../context-engine/coding-observability.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import {
  classifyWriteDestructiveTier,
  wrapToolWithDestructiveTier,
} from "../write-destructive-tier.js";

describe("write-destructive-tier (C2-10)", () => {
  beforeEach(() => codingObservability.reset());
  afterEach(() => codingObservability.reset());

  it("delete patch is destructive with approval", () => {
    const c = classifyWriteDestructiveTier({
      toolName: "apply_patch",
      args: {
        input: "*** Begin Patch\n*** Delete File: a.ts\n*** End Patch",
      },
    });
    expect(c.tier).toBe("destructive");
    expect(c.requiresApproval).toBe(true);
  });

  it("edit with journal is reversible without approval", () => {
    const c = classifyWriteDestructiveTier({
      toolName: "edit",
      args: { path: "a.ts", edits: [] },
      journalEnabled: true,
    });
    expect(c.tier).toBe("reversible");
    expect(c.requiresApproval).toBe(false);
  });

  it("wrapper records approval skip for normal edit", async () => {
    const tool = {
      name: "edit",
      label: "Edit",
      description: "e",
      parameters: {},
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    } as AnyAgentTool;
    const wrapped = wrapToolWithDestructiveTier(tool, { journalEnabled: true });
    const result = await wrapped.execute("1", { path: "a.ts" });
    expect((result.details as { destructive_tier?: string }).destructive_tier).toBe("reversible");
    expect(codingObservability.snapshot().approvalSkips).toBe(1);
    expect(codingObservability.snapshot().approvalPrompts).toBe(0);
  });

  it("delete patch wrapper prompts approval", async () => {
    const tool = {
      name: "apply_patch",
      label: "p",
      description: "p",
      parameters: {},
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    } as AnyAgentTool;
    const wrapped = wrapToolWithDestructiveTier(tool);
    await wrapped.execute("1", {
      input: "*** Begin Patch\n*** Delete File: a.ts\n*** End Patch",
    });
    expect(codingObservability.snapshot().approvalPrompts).toBe(1);
  });
});
