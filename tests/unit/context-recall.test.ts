import { describe, expect, it } from "vitest";
import {
  aggregateContextRecall,
  computeContextRecall,
} from "./helpers/runtime-memory-context-recall";

describe("runtime memory context recall", () => {
  it("scores full, partial, and absent evidence", () => {
    const context = "Alice said she moved to Seattle for a robotics role.";
    expect(computeContextRecall(context, ["Alice moved to Seattle for robotics"])).toBe(1);
    expect(computeContextRecall(context, ["Alice moved to Portland for robotics"])).toBe(0.5);
    expect(computeContextRecall(context, ["Caroline adopted a sourdough starter"])).toBe(0);
  });

  it("aggregates by category", () => {
    const aggregate = aggregateContextRecall([
      {
        category: "single_hop",
        assembledContext: "Alice moved to Seattle",
        goldEvidence: ["Alice moved to Seattle"],
      },
      {
        category: "temporal",
        assembledContext: "No matching evidence",
        goldEvidence: ["Caroline visited Rome"],
      },
    ]);

    expect(aggregate.overall.contextRecall).toBe(0.5);
    expect(aggregate.byCategory.single_hop.contextRecall).toBe(1);
    expect(aggregate.byCategory.temporal.contextRecall).toBe(0);
  });
});
