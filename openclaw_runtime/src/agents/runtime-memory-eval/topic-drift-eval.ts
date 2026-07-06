// Topic drift evaluation for runtime-memory.
// Pure functions: buildTopicSegments produces per-topic plans; evaluateTopicDrift
// consumes pre-computed diagnostics to derive per-topic recall, cross-topic
// interference, and drift recovery time.
// Fills the "no cross-topic interference measurement" gap from Phase 35/36.

import type { RuntimeMemoryTemporalFact } from "../../runtime-core/memory-context.js";
import type { TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics } from "../../runtime-core/task-loop-memory-shadow-diagnostics.js";
import type { MultiTurnQueryPlan } from "./multi-turn-driver.js";

export type TopicSegment = {
  topicId: string;
  subject: string;
  turns: number;
  writeFact: RuntimeMemoryTemporalFact;
  queries: readonly MultiTurnQueryPlan[];
};

export type TopicDriftResult = {
  perTopicRecall: ReadonlyArray<{ topicId: string; recall: number }>;
  crossTopicInterference: number;
  driftRecoveryTime: number;
  totalTurns: number;
};

export function buildTopicSegments(options: {
  topicCount: number;
  turnsPerTopic: number;
  taskId: string;
  referenceTime: number;
}): readonly TopicSegment[] {
  if (options.topicCount < 1) {
    throw new Error(`buildTopicSegments: topicCount must be >= 1 (got ${options.topicCount})`);
  }
  if (options.turnsPerTopic < 1) {
    throw new Error(`buildTopicSegments: turnsPerTopic must be >= 1 (got ${options.turnsPerTopic})`);
  }

  const segments: TopicSegment[] = [];
  for (let topic = 0; topic < options.topicCount; topic += 1) {
    const topicId = `topic_${topic}`;
    const subject = `TopicSubject_${topic}`;
    const predicate = `topic_predicate`;
    const factId = `${topicId}_fact`;

    const writeFact: RuntimeMemoryTemporalFact = {
      schemaVersion: 1,
      factId,
      taskId: options.taskId,
      subject,
      predicate,
      objectSummary: `Fact for ${topicId}.`,
      confidence: 0.9,
      source: "verifier_summary",
      verificationStatus: "verified",
      valid_at: options.referenceTime,
      reference_time: options.referenceTime,
      acceptedAt: options.referenceTime,
      sourceEpisodeRefs: [
        {
          episodeId: `episode_${topicId}`,
          taskId: options.taskId,
          kind: "verifier_summary",
          idempotencyKey: `${options.taskId}:${topicId}`,
          reference_time: options.referenceTime,
        },
      ],
      evidenceRefs: [
        {
          type: "test",
          ref: "openclaw_runtime/src/agents/runtime-memory-eval/topic-drift-eval.ts",
        },
      ],
      promotion: {
        promotedBy: "verifier",
        evidenceRefs: [
          {
            type: "test",
            ref: "openclaw_runtime/src/agents/runtime-memory-eval/topic-drift-eval.ts",
          },
        ],
      },
    };

    const queries: MultiTurnQueryPlan[] = [];
    for (let turn = 0; turn < options.turnsPerTopic; turn += 1) {
      queries.push({
        queryId: `${topicId}_query_${turn}`,
        taskId: options.taskId,
        subject,
        predicate,
        referenceTime: options.referenceTime,
        tokenBudget: 512,
        limit: 4,
        expectedFactIds: [factId],
      });
    }

    segments.push({
      topicId,
      subject,
      turns: options.turnsPerTopic,
      writeFact,
      queries,
    });
  }

  return segments;
}

export function evaluateTopicDrift(
  segments: readonly TopicSegment[],
  diagnostics: ReadonlyArray<
    TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics
  >,
): TopicDriftResult {
  if (segments.length === 0) {
    return {
      perTopicRecall: [],
      crossTopicInterference: 0,
      driftRecoveryTime: 0,
      totalTurns: 0,
    };
  }

  const expectedTotalQueries = segments.reduce((sum, s) => sum + s.queries.length, 0);
  if (diagnostics.length !== expectedTotalQueries) {
    throw new Error(
      `evaluateTopicDrift: diagnostics.length (${diagnostics.length}) must equal total queries (${expectedTotalQueries})`,
    );
  }

  // Map each segment's subject for cross-topic interference detection.
  const segmentBySubject = new Map(segments.map((s) => [s.subject, s]));

  const perTopicRecall: Array<{ topicId: string; recall: number }> = [];
  let totalExtraneous = 0;
  let totalAccepted = 0;
  let diagIndex = 0;

  for (const segment of segments) {
    let topicTruePositive = 0;
    let topicExpected = 0;

    for (let turn = 0; turn < segment.turns; turn += 1) {
      const diag = diagnostics[diagIndex];
      diagIndex += 1;
      const queryResult = diag.queries[0];
      if (!queryResult) continue;

      topicTruePositive += queryResult.truePositiveCount;
      topicExpected += queryResult.expectedFactIds.length;

      // Cross-topic interference: accepted facts whose subject differs from the query subject.
      for (const fact of queryResult.acceptedFacts) {
        totalAccepted += 1;
        if (fact.subject !== segment.subject) {
          totalExtraneous += 1;
        }
      }
    }

    perTopicRecall.push({
      topicId: segment.topicId,
      recall: topicExpected === 0 ? 1 : topicTruePositive / topicExpected,
    });
  }

  const crossTopicInterference = totalAccepted === 0 ? 0 : totalExtraneous / totalAccepted;

  // Drift recovery time: after the first topic switch, how many turns into
  // the new segment until recall >= 0.8. If the first turn of the new segment
  // already has recall >= 0.8, recovery time = 1.
  let driftRecoveryTime = 0;
  if (segments.length >= 2) {
    const secondSegment = segments[1];
    let turn = 0;
    diagIndex = segments[0].turns; // Skip first segment's diagnostics
    while (turn < secondSegment.turns) {
      const diag = diagnostics[diagIndex];
      diagIndex += 1;
      const queryResult = diag.queries[0];
      const expected = queryResult?.expectedFactIds.length ?? 0;
      const tp = queryResult?.truePositiveCount ?? 0;
      const recall = expected === 0 ? 1 : tp / expected;
      turn += 1;
      if (recall >= 0.8) {
        driftRecoveryTime = turn;
        break;
      }
    }
    if (driftRecoveryTime === 0) {
      driftRecoveryTime = secondSegment.turns; // Never recovered
    }
  }

  return {
    perTopicRecall,
    crossTopicInterference,
    driftRecoveryTime,
    totalTurns: expectedTotalQueries,
  };
}
