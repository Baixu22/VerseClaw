// #136 retrieval-only attribution: proves the diagnostic can tell extraction loss from
// ranking loss without any model call, and that it refuses to become a score claim.
import { describe, expect, it } from "vitest";
import {
  assertRetrievalOnlyDisclosure,
  attributeRetrieval,
  summarizeRetrievalAttribution,
  type RetrievalAttribution,
  type RetrievalAttributionInput,
  type RetrievalAttributionSummary,
} from "./helpers/locomo-retrieval-attribution";

const GOLD_TURN_ID = "D1:1";
const GOLD_TURN_TEXT = "Caroline attended an LGBTQ support group on 2023-05-07";
const ON_TOPIC = "Caroline attended an LGBTQ support group on 2023-05-07 and felt accepted";
const OFF_TOPIC = "Bob went hiking with friends near the lake";

const evidenceTextById = new Map([[GOLD_TURN_ID, GOLD_TURN_TEXT]]);

function input(overrides: Partial<RetrievalAttributionInput> = {}): RetrievalAttributionInput {
  return {
    questionId: "conv-1_q1",
    category: "temporal",
    conversationId: "conv-1",
    question: "When did Caroline attend the support group?",
    goldEvidence: [GOLD_TURN_ID],
    retrievedFactSummaries: [ON_TOPIC],
    memoryFactSummaries: [ON_TOPIC, OFF_TOPIC],
    evidenceTextById,
    ...overrides,
  };
}

describe("retrieval-only attribution", () => {
  it("marks a question whose gold evidence reached the top-5", () => {
    const row = attributeRetrieval(input());
    expect(row.bucket).toBe("retrieved_in_top5");
    expect(row.memoryCoverage).toBe(1);
    expect(row.top5Coverage).toBe(1);
    expect(row.goldTurnCount).toBe(1);
  });

  it("separates a ranking loss from an extraction loss", () => {
    // The fact is in memory but the retrieved top-5 is off topic: a ranking loss.
    const rankedOut = attributeRetrieval(input({ retrievedFactSummaries: [OFF_TOPIC] }));
    expect(rankedOut.bucket).toBe("in_memory_but_not_top5");
    expect(rankedOut.memoryCoverage).toBe(1);
    expect(rankedOut.top5Coverage).toBe(0);

    // The fact never made it into memory at all: an extraction loss.
    const absent = attributeRetrieval(
      input({ memoryFactSummaries: [OFF_TOPIC], retrievedFactSummaries: [OFF_TOPIC] }),
    );
    expect(absent.bucket).toBe("absent_from_memory");
    expect(absent.memoryCoverage).toBe(0);
  });

  it("treats a half-covered gold turn as present in memory", () => {
    // Four of eight content words survive, which is the 0.5 lexical-coverage band.
    const partial = attributeRetrieval(
      input({ memoryFactSummaries: ["Caroline attended an LGBTQ gathering"], retrievedFactSummaries: [OFF_TOPIC] }),
    );
    expect(partial.memoryCoverage).toBe(0.5);
    expect(partial.bucket).toBe("in_memory_but_not_top5");
  });

  it("refuses to attribute a question that has no gold evidence", () => {
    const row = attributeRetrieval(input({ goldEvidence: [] }));
    expect(row.bucket).toBe("no_gold_evidence");
    expect(row.memoryCoverage).toBe(0);
    expect(row.top5Coverage).toBe(0);
    expect(row.goldTurnCount).toBe(0);
  });

  it("pairs temporal against the other categories in the same sample", () => {
    const rows: RetrievalAttribution[] = [
      attributeRetrieval(input({ questionId: "t1" })),
      attributeRetrieval(input({ questionId: "t2", retrievedFactSummaries: [OFF_TOPIC] })),
      attributeRetrieval(input({ questionId: "s1", category: "single_hop" })),
      attributeRetrieval(input({ questionId: "s2", category: "single_hop" })),
    ];
    const summary = summarizeRetrievalAttribution(rows, new Map([["t1", 1], ["s1", 0.5]]));

    expect(summary.scope).toBe("retrieval-only-diagnostic");
    expect(summary.overall.questions).toBe(4);
    expect(summary.paired.comparable).toBe(true);
    expect(summary.paired.temporal.questions).toBe(2);
    expect(summary.paired.nonTemporal.questions).toBe(2);
    // temporal top-5 coverage is 0.5, the other categories are 1.0.
    expect(summary.paired.temporalMinusNonTemporalTop5Coverage).toBeCloseTo(-0.5, 12);
    expect(summary.paired.temporal.bucketCounts.in_memory_but_not_top5).toBe(1);
    expect(summary.paired.temporal.bucketCounts.retrieved_in_top5).toBe(1);
    // The run's own recall@5 is reported, not a second invented metric.
    expect(summary.overall.recall5Mean).toBeCloseTo(0.375, 12);
    expect(summary.byCategory.single_hop.recall5Mean).toBeCloseTo(0.25, 12);
  });

  it("does not invent a temporal delta when there is only one side", () => {
    const summary = summarizeRetrievalAttribution([attributeRetrieval(input())]);
    expect(summary.paired.comparable).toBe(false);
    expect(summary.paired.nonTemporal.questions).toBe(0);
    expect(summary.paired.nonTemporal.top5Coverage).toBe(0);
  });

  it("enforces the retrieval-only boundary instead of only documenting it", () => {
    const summary = summarizeRetrievalAttribution([attributeRetrieval(input())]);
    expect(() => assertRetrievalOnlyDisclosure(summary)).not.toThrow();
    expect(JSON.stringify(summary)).not.toMatch(/j_?score/i);

    const smuggled = {
      ...summary,
      overall: { ...summary.overall, j_score: 1 },
    } as unknown as RetrievalAttributionSummary;
    expect(() => assertRetrievalOnlyDisclosure(smuggled)).toThrow(/judge score field/);

    const claimed = {
      ...summary,
      claims: { ...summary.claims, judgeScoreClaimed: true },
    } as unknown as RetrievalAttributionSummary;
    expect(() => assertRetrievalOnlyDisclosure(claimed)).toThrow(/must not claim/);
  });
});
