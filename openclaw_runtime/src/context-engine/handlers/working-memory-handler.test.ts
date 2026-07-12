import { describe, expect, it } from "vitest";
import type { ContextBlock } from "../block.js";
import {
  handleWorkingMemoryAction,
  parseWorkingMemoryActions,
  type WorkingMemoryAction,
} from "./working-memory-handler.js";

const BASE_TIME = new Date("2026-07-10T00:00:00.000Z");

describe("DCS Stage 1 working-memory handler", () => {
  it("constructs one stable per-session working_memory block for high and medium actions", () => {
    const block = handleWorkingMemoryAction({
      sessionId: "agent:alpha:main",
      now: BASE_TIME,
      action: makeAction("write", "Created the migration", "high"),
    });

    expect(block).toMatchObject({
      block_id: "working-memory:agent:alpha:main",
      block_type: "working_memory",
      source_system: "working-memory",
      session_id: "agent:alpha:main",
      mutability: "system_managed",
      compression_depth: 0,
      entity_extraction_status: "empty",
    });
    expect(parseWorkingMemoryActions(block)).toEqual([
      makeAction("write", "Created the migration", "high"),
    ]);
  });

  it("merges with the accepted persisted baseline instead of advancing rejected writes", () => {
    const accepted = handleWorkingMemoryAction({
      sessionId: "session-a",
      now: BASE_TIME,
      action: makeAction("edit", "Accepted update", "high"),
    });
    const rejectedAttempt = handleWorkingMemoryAction({
      sessionId: "session-a",
      now: BASE_TIME,
      existingBlock: accepted,
      action: makeAction("grep", "Rejected update", "medium"),
    });

    const nextAccepted = handleWorkingMemoryAction({
      sessionId: "session-a",
      now: BASE_TIME,
      existingBlock: accepted,
      action: makeAction("read", "Next accepted update", "medium"),
    });

    expect(parseWorkingMemoryActions(rejectedAttempt)).toHaveLength(2);
    expect(parseWorkingMemoryActions(nextAccepted).map((action) => action.result_summary)).toEqual([
      "Accepted update",
      "Next accepted update",
    ]);
  });

  it("caps the window at five and evicts oldest medium before oldest high deterministically", () => {
    let block: ContextBlock | undefined;
    for (const action of [
      makeAction("tool-1", "high-1", "high"),
      makeAction("tool-2", "medium-1", "medium"),
      makeAction("tool-3", "high-2", "high"),
      makeAction("tool-4", "medium-2", "medium"),
      makeAction("tool-5", "high-3", "high"),
      makeAction("tool-6", "high-4", "high"),
    ] satisfies WorkingMemoryAction[]) {
      block = handleWorkingMemoryAction({
        sessionId: "session-a",
        now: BASE_TIME,
        existingBlock: block,
        action,
      });
    }

    expect(parseWorkingMemoryActions(block).map((action) => action.result_summary)).toEqual([
      "high-1",
      "high-2",
      "medium-2",
      "high-3",
      "high-4",
    ]);
  });

  it("evicts oldest high only when no medium action exists", () => {
    let block: ContextBlock | undefined;
    for (let index = 1; index <= 6; index += 1) {
      block = handleWorkingMemoryAction({
        sessionId: "session-a",
        now: BASE_TIME,
        existingBlock: block,
        action: makeAction(`tool-${index}`, `high-${index}`, "high"),
      });
    }

    expect(parseWorkingMemoryActions(block).map((action) => action.result_summary)).toEqual([
      "high-2",
      "high-3",
      "high-4",
      "high-5",
      "high-6",
    ]);
  });
});

function makeAction(
  tool: string,
  result_summary: string,
  significance: WorkingMemoryAction["significance"],
): WorkingMemoryAction {
  return { tool, result_summary, significance };
}