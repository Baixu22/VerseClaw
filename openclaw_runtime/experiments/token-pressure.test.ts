import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LifecycleBlock } from "../src/context-engine/block-lifecycle.js";
import { selectBlocksUnderTokenPressure } from "./token-pressure.js";
import { codingObservability } from "../src/context-engine/coding-observability.js";

function blk(type: LifecycleBlock["block_type"], content: string): LifecycleBlock {
  return {
    block_id: type,
    block_type: type,
    source_system: "working-memory",
    presence: { always_on: false },
    entities: [],
    valid_at: new Date(),
    created_at: new Date(),
    mutability: "system_managed",
    summary: content.slice(0, 20),
    full_content: content,
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

describe("token-pressure (C6-3)", () => {
  beforeEach(() => codingObservability.reset());
  afterEach(() => codingObservability.reset());

  it("never drops persona/task_state in emergency even under tight budget", () => {
    const kept = selectBlocksUnderTokenPressure({
      blocks: [
        blk("persona", "persona-core"),
        blk("task_state", "task-core"),
        blk("notes", "n".repeat(50_000)),
      ],
      tokenBudget: 1,
      mode: "emergency",
      estimateTokens: (b) => (b.block_type === "notes" ? 10_000 : 100),
    });
    expect(kept.map((b) => b.block_type).sort()).toEqual(["persona", "task_state"]);
    expect(
      codingObservability.snapshot().compactionLayerHits.token_pressure_emergency,
    ).toBe(1);
  });
});
