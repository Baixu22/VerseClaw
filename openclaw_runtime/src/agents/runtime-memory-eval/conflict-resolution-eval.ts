// Conflict resolution evaluation for runtime-memory.
// Pure functions: buildConflictScenario produces conflicting fact groups;
// evaluateConflictResolution consumes pre-computed diagnostics to verify
// the consumer's selectConflictWinners picks the correct winner per group.
// Fills the "no conflict-winner correctness test" gap — all other enhanced
// dimensions deliberately avoid conflicts.
//
// Winner selection (from compareFactRank in memory-read-hydration-consumer.ts):
// 1. Higher confidence wins
// 2. If tied, later valid_at wins
// 3. If tied, later reference_time wins
// 4. If tied, smaller factId wins (localeCompare)

import type { RuntimeMemoryTemporalFact } from "../../runtime-core/memory-context.js";
import type { TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics } from "../../runtime-core/task-loop-memory-shadow-diagnostics.js";
import type { MultiTurnQueryPlan } from "./multi-turn-driver.js";

export type ConflictGroup = {
  groupId: string;
  subject: string;
  predicate: string;
  facts: readonly RuntimeMemoryTemporalFact[];
  expectedWinnerFactId: string;
  query: MultiTurnQueryPlan;
};

export type ConflictResolutionResult = {
  perGroup: ReadonlyArray<{
    groupId: string;
    acceptedFactId: string | null;
    expectedWinnerFactId: string;
    correct: boolean;
    candidateCount: number;
  }>;
  conflictSuppressionRate: number;
  wrongConflictWinnerRate: number;
  totalConflicts: number;
};

export function buildConflictScenario(options: {
  groupCount: number;
  taskId: string;
  referenceTime: number;
}): readonly ConflictGroup[] {
  if (options.groupCount < 1) {
    throw new Error(
      `buildConflictScenario: groupCount must be >= 1 (got ${options.groupCount})`,
    );
  }

  const groups: ConflictGroup[] = [];

  for (let g = 0; g < options.groupCount; g += 1) {
    const groupId = `conflict_group_${g}`;
    const subject = `ConflictSubject_${g}`;
    const predicate = `conflict_predicate_${g}`;

    // Vary the conflict pattern across groups to test all tiebreaker rules.
    // Group g%3 === 0: different confidence (winner = highest confidence)
    // Group g%3 === 1: same confidence, different valid_at (winner = latest valid_at)
    // Group g%3 === 2: same confidence + valid_at, different factId (winner = smallest factId)
    const pattern = g % 3;
    const facts: RuntimeMemoryTemporalFact[] = [];
    let expectedWinnerFactId: string;

    if (pattern === 0) {
      // Different confidence: 0.5, 0.9, 0.7 → winner = 0.9 (index 1)
      const confidences = [0.5, 0.9, 0.7];
      for (let i = 0; i < confidences.length; i += 1) {
        facts.push(
          buildConflictFact(
            `${groupId}_fact_${i}`,
            options.taskId,
            subject,
            predicate,
            options.referenceTime,
            confidences[i],
            options.referenceTime,
          ),
        );
      }
      expectedWinnerFactId = `${groupId}_fact_1`;
    } else if (pattern === 1) {
      // Same confidence, different valid_at: 100, 500, 300 → winner = 500 (index 1)
      const validAts = [100, 500, 300];
      for (let i = 0; i < validAts.length; i += 1) {
        facts.push(
          buildConflictFact(
            `${groupId}_fact_${i}`,
            options.taskId,
            subject,
            predicate,
            options.referenceTime,
            0.9,
            validAts[i],
          ),
        );
      }
      expectedWinnerFactId = `${groupId}_fact_1`;
    } else {
      // Same confidence + valid_at, different factId → winner = smallest factId
      // Use factIds that sort as: aaa, bbb, ccc → winner = aaa (index 0)
      const factIdSuffixes = ["aaa", "bbb", "ccc"];
      for (let i = 0; i < factIdSuffixes.length; i += 1) {
        facts.push(
          buildConflictFact(
            `${groupId}_fact_${factIdSuffixes[i]}`,
            options.taskId,
            subject,
            predicate,
            options.referenceTime,
            0.9,
            options.referenceTime,
          ),
        );
      }
      expectedWinnerFactId = `${groupId}_fact_aaa`;
    }

    groups.push({
      groupId,
      subject,
      predicate,
      facts,
      expectedWinnerFactId,
      query: {
        queryId: `conflict_query_${g}`,
        taskId: options.taskId,
        subject,
        predicate,
        referenceTime: options.referenceTime,
        tokenBudget: 512,
        limit: 4,
        expectedFactIds: [expectedWinnerFactId],
      },
    });
  }

  return groups;
}

function buildConflictFact(
  factId: string,
  taskId: string,
  subject: string,
  predicate: string,
  referenceTime: number,
  confidence: number,
  validAt: number,
): RuntimeMemoryTemporalFact {
  return {
    schemaVersion: 1,
    factId,
    taskId,
    subject,
    predicate,
    objectSummary: `Conflict fact ${factId}.`,
    confidence,
    source: "verifier_summary",
    verificationStatus: "verified",
    valid_at: validAt,
    reference_time: referenceTime,
    acceptedAt: referenceTime,
    sourceEpisodeRefs: [
      {
        episodeId: `episode_${factId}`,
        taskId,
        kind: "verifier_summary",
        idempotencyKey: `${taskId}:${factId}`,
        reference_time: referenceTime,
      },
    ],
    evidenceRefs: [
      {
        type: "test",
        ref: "openclaw_runtime/src/agents/runtime-memory-eval/conflict-resolution-eval.ts",
      },
    ],
    promotion: {
      promotedBy: "verifier",
      evidenceRefs: [
        {
          type: "test",
          ref: "openclaw_runtime/src/agents/runtime-memory-eval/conflict-resolution-eval.ts",
        },
      ],
    },
  };
}

export function evaluateConflictResolution(
  scenario: readonly ConflictGroup[],
  diagnostics: ReadonlyArray<
    TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics
  >,
): ConflictResolutionResult {
  if (scenario.length === 0) {
    return {
      perGroup: [],
      conflictSuppressionRate: 1,
      wrongConflictWinnerRate: 0,
      totalConflicts: 0,
    };
  }
  if (diagnostics.length !== scenario.length) {
    throw new Error(
      `evaluateConflictResolution: diagnostics.length (${diagnostics.length}) must equal scenario.length (${scenario.length})`,
    );
  }

  const perGroup = scenario.map((group, index) => {
    const diag = diagnostics[index];
    const queryResult = diag.queries[0];
    const acceptedFacts = queryResult?.acceptedFacts ?? [];
    const acceptedFactId = acceptedFacts.length > 0 ? acceptedFacts[0].factId : null;
    const correct = acceptedFactId === group.expectedWinnerFactId;
    const candidateCount = group.facts.length;

    return {
      groupId: group.groupId,
      acceptedFactId,
      expectedWinnerFactId: group.expectedWinnerFactId,
      correct,
      candidateCount,
    };
  });

  const totalCandidates = perGroup.reduce((sum, g) => sum + g.candidateCount, 0);
  const totalAccepted = perGroup.filter((g) => g.acceptedFactId !== null).length;
  const totalRejected = totalCandidates - totalAccepted;
  const conflictSuppressionRate =
    totalCandidates === 0 ? 1 : totalRejected / totalCandidates;

  const wrongCount = perGroup.filter((g) => !g.correct).length;
  const wrongConflictWinnerRate = wrongCount / scenario.length;

  return {
    perGroup,
    conflictSuppressionRate,
    wrongConflictWinnerRate,
    totalConflicts: totalCandidates,
  };
}
