import { describe, expect, it } from "vitest";
import { handleWorkingMemoryAction } from "../../context-engine/handlers/working-memory-handler.js";

/**
 * C2-6 joint accept: write tool envelopes carry working_memory and can be
 * admitted into a working_memory block visible to context_read queries.
 */
describe("working-memory envelope joint (C2-6)", () => {
  it("admits write working_memory into block store shape", () => {
    const envelope = {
      tool: "write",
      result_summary: "Wrote src/auth.ts (+12 -3)",
      significance: "high" as const,
    };
    const block = handleWorkingMemoryAction({
      sessionId: "sess-joint",
      action: envelope,
    });
    expect(block.block_type).toBe("working_memory");
    expect(block.session_id).toBe("sess-joint");
    expect(block.full_content).toContain("Wrote src/auth.ts");
    // context_read would query block_types: ["working_memory"] for this session
    const parsed = JSON.parse(block.full_content ?? "{}") as {
      actions: Array<{ tool: string }>;
    };
    expect(parsed.actions[0]?.tool).toBe("write");
  });
});
