import { describe, expect, it } from "vitest";
import { assertLocomoStageReportShape } from "./helpers/runtime-memory-locomo-report-schema";

function makeReport(): Record<string, unknown> {
  const sampleResults = Array.from({ length: 20 }, (_, index) => ({
    questionId: `conv-1_q${index}`,
    category: "single_hop",
    conversationId: "conv-1",
    question: `Question ${index}?`,
    goldEvidence: [`Evidence ${index}`],
    recall5: 1,
    contextRecall: 1,
    judgeScore: 1,
    escalationLevel: 0,
    predictedAnswer: "answer",
    groundTruth: "answer",
    assembledContext: "Evidence",
  }));

  return {
    dataset: "locomo",
    version: "10.0-stage2-adaptive-retrieval",
    totalQuestions: 500,
    retrievalMode: "Stage 2 adaptive retrieval",
    judgeModel: "deepseek-chat (frozen-v1-2026-07-02)",
    judgeConfig: {
      model: "deepseek-chat",
      temperature: 0,
      promptVersion: "frozen-v1-2026-07-02",
      promptTemplate: "Judge prompt.",
    },
    metric: "J Score with context recall",
    sampleSizes: {
      multi_hop: 96,
      temporal: 150,
      single_hop: 127,
      open_domain: 127,
    },
    sampleSeed: 42,
    metrics: {
      overall: {
        j_score: 0.64,
        recall_at_5: 0.5,
        context_recall: 0.7,
        escalation_rate: 0.25,
        cost_per_run_estimate_usd: 6.5,
      },
      byCategory: {
        single_hop: {
          j_score: 0.67,
          recall_at_5: 0.55,
          context_recall: 0.72,
          count: 127,
        },
      },
    },
    errorTaxonomy: {
      overall: {
        not_retrieved: 1,
        retrieved_not_used: 2,
        used_but_misreasoned: 3,
        judge_error: 0,
      },
      byCategory: {},
    },
    escalation: {
      totalQuestions: 500,
      level0: 375,
      level1: 100,
      level2: 25,
      capped: 0,
      fullConversationCapped: 0,
      maxEscalations: 200,
      maxFullConversationEscalations: 200,
      escalationRate: 0.25,
      fullConversationRate: 0.05,
    },
    extraction: {
      factsCachePath: "artifacts/runtime-memory-eval/extracted-facts-cache-v2.json",
      cachedConversations: 8,
      freshConversations: 2,
      totalChunks: 40,
      parseFailures: 1,
      parseSuccessRate: 0.975,
      conversations: [
        {
          conversationId: "conv-1",
          totalChunks: 4,
          parseFailures: 0,
          parseSuccessRate: 1,
          extractedFacts: 30,
          uniqueFacts: 25,
        },
      ],
    },
    cost: {
      estimateUsd: 6.5,
      projectedFullRunEstimateUsd: 6.5,
      deepSeekUsage: {
        calls: 1000,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    },
    comparison: {
      ours: { j_score: 0.64 },
    },
    sampleResults,
    judgeSanityCandidates: [
      {
        questionId: "conv-1_q1",
        category: "single_hop",
        conversationId: "conv-1",
        question: "Question 1?",
        groundTruth: "answer",
        predictedAnswer: "wrong",
        judgeScore: 0,
      },
    ],
    generatedAt: "2026-07-03T00:00:00.000Z",
  };
}

describe("runtime memory LoCoMo report schema", () => {
  it("accepts reports with required Stage 1/2 evidence fields", () => {
    expect(() => assertLocomoStageReportShape(makeReport())).not.toThrow();
  });

  it("rejects reports missing context recall", () => {
    const report = makeReport();
    const metrics = report.metrics as {
      overall: Record<string, unknown>;
    };
    delete metrics.overall.context_recall;

    expect(() => assertLocomoStageReportShape(report)).toThrow(
      /context_recall/,
    );
  });

  it("rejects camelCase by-category metric fields", () => {
    const report = makeReport();
    const metrics = report.metrics as {
      byCategory: { single_hop: Record<string, unknown> };
    };
    delete metrics.byCategory.single_hop.j_score;
    metrics.byCategory.single_hop.jScore = 0.67;

    expect(() => assertLocomoStageReportShape(report)).toThrow(/j_score/);
  });

  it("rejects reports missing extraction telemetry", () => {
    const report = makeReport();
    delete report.extraction;

    expect(() => assertLocomoStageReportShape(report)).toThrow(/extraction/);
  });
});
