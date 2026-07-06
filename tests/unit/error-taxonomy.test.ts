import { describe, expect, it } from "vitest";
import {
  aggregateErrorTaxonomy,
  classifyErrorTaxonomy,
  parseErrorTaxonomyResponse,
} from "./helpers/runtime-memory-error-taxonomy";

describe("runtime memory error taxonomy", () => {
  it("parses classifier JSON", () => {
    expect(
      parseErrorTaxonomyResponse(
        '{"bucket":"retrieved_not_used","reason":"Evidence was present but ignored."}',
      ),
    ).toEqual({
      bucket: "retrieved_not_used",
      reason: "Evidence was present but ignored.",
    });
  });

  it("skips correct answers and classifies wrong answers", async () => {
    const correct = await classifyErrorTaxonomy(
      {
        question: "Q",
        assembledContext: "C",
        predictedAnswer: "A",
        groundTruth: "A",
        judgeScore: 1,
      },
      async () => {
        throw new Error("should not call");
      },
    );
    expect(correct).toBeNull();

    const wrong = await classifyErrorTaxonomy(
      {
        question: "Q",
        assembledContext: "C",
        predictedAnswer: "wrong",
        groundTruth: "right",
        judgeScore: 0,
      },
      async () => ({
        content: '{"bucket":"not_retrieved","reason":"Gold evidence absent."}',
      }),
    );
    expect(wrong?.bucket).toBe("not_retrieved");
  });

  it("aggregates bucket counts", () => {
    const aggregate = aggregateErrorTaxonomy([
      {
        category: "single_hop",
        bucket: "not_retrieved",
        reason: "",
        question: "",
        assembledContext: "",
        predictedAnswer: "",
        groundTruth: "",
        judgeScore: 0,
      },
      {
        category: "single_hop",
        bucket: "judge_error",
        reason: "",
        question: "",
        assembledContext: "",
        predictedAnswer: "",
        groundTruth: "",
        judgeScore: 0,
      },
    ]);

    expect(aggregate.overall.not_retrieved).toBe(1);
    expect(aggregate.byCategory.single_hop.judge_error).toBe(1);
  });
});
