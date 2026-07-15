import { describe, expect, it } from "vitest";
import {
  archiveLowHeatBlocks,
  filterBlocksByLifecycle,
  type LifecycleBlock,
} from "./block-lifecycle.js";
import { selectBlocksUnderTokenPressure } from "./token-pressure.js";
import { compressToolOutputText } from "../agents/tool-output-compress.js";

function blk(type: LifecycleBlock["block_type"], heat = 0, content = "x".repeat(100)): LifecycleBlock {
  return {
    block_id: `${type}-${heat}`,
    block_type: type,
    source_system: "working-memory",
    presence: { always_on: false },
    entities: [],
    valid_at: new Date(),
    mutability: "system_managed",
    summary: content.slice(0, 20),
    full_content: content,
    compression_depth: 0,
    entity_extraction_status: "empty",
    heat,
  };
}

describe("context ladder (C6)", () => {
  it("archives low-heat blocks without dropping", () => {
    const out = archiveLowHeatBlocks([blk("notes", 0), blk("persona", 0)]);
    expect(out.find((b) => b.block_type === "notes")?.lifecycle_state).toBe("archived");
    expect(out.find((b) => b.block_type === "persona")?.lifecycle_state).not.toBe("archived");
    const activeOnly = filterBlocksByLifecycle(out);
    expect(activeOnly.every((b) => b.lifecycle_state !== "archived")).toBe(true);
    expect(filterBlocksByLifecycle(out, { includeArchived: true })).toHaveLength(2);
  });

  it("compresses oversized tool output", () => {
    const big = "a".repeat(10_000);
    const c = compressToolOutputText(big, { limit: 4000 });
    expect(c.truncated).toBe(true);
    expect(c.text.length).toBeLessThan(big.length);
  });

  it("emergency pressure keeps persona/task_state", () => {
    const kept = selectBlocksUnderTokenPressure({
      blocks: [blk("persona", 1, "p"), blk("notes", 1, "n".repeat(5000)), blk("task_state", 1, "t")],
      tokenBudget: 500,
      mode: "emergency",
    });
    expect(kept.map((b) => b.block_type).sort()).toEqual(["persona", "task_state"]);
  });
});
