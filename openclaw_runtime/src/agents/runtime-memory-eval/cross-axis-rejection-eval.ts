// Cross-axis rejection evaluation for runtime-memory.
// Pure functions: buildCrossAxisScenario produces 1 clean fact + 10 facts that
// each trigger a distinct consumer rejection reason; evaluateCrossAxisRejection
// consumes pre-computed consumer results to verify each fact was rejected with
// the correct reason.
//
// Fills the "4 rejection reasons have no enhanced-eval assertion" gap:
// subject_mismatch, invalidated_at_reference_time, token_budget_exceeded, and
// limit_exceeded were only tested in legacy tests, not in the enhanced suite.
//
// Calls consumeRuntimeMemoryHydrationFacts directly (same pattern as
// hazard-sentinel-eval) because the shadow reader sanitizes/modifies fact
// text before the consumer can see it.

import type {
  RuntimeMemoryHydrationConsumerQuery,
  RuntimeMemoryHydrationConsumerResult,
  RuntimeMemoryHydrationConsumerRejectionReason,
  RuntimeMemoryHydrationShadowFactProjection,
} from "../../runtime-core/memory-read-hydration-consumer.js";

export type CrossAxisFactSpec = {
  factId: string;
  label: string;
  expectedRejectionReason: RuntimeMemoryHydrationConsumerRejectionReason;
  projection: RuntimeMemoryHydrationShadowFactProjection;
  query: RuntimeMemoryHydrationConsumerQuery;
  isClean: boolean;
};

export type CrossAxisRejectionResult = {
  perReason: ReadonlyArray<{
    reason: RuntimeMemoryHydrationConsumerRejectionReason;
    factId: string;
    rejected: boolean;
    correctReason: boolean;
    actualReason?: RuntimeMemoryHydrationConsumerRejectionReason;
  }>;
  allReasonsFired: boolean;
  cleanFactAccepted: boolean;
  rejectionCoverage: number;
  correctReasonRate: number;
};

export const CROSS_AXIS_REJECTION_REASONS: readonly RuntimeMemoryHydrationConsumerRejectionReason[] = [
  "record_kind_not_fact",
  "verification_status_not_verified",
  "future_valid_at",
  "invalidated_at_reference_time",
  "expired_at_reference_time",
  "task_mismatch",
  "subject_mismatch",
  "predicate_mismatch",
  "token_budget_exceeded",
  "limit_exceeded",
];

export function buildCrossAxisScenario(options: {
  taskId: string;
  subject: string;
  predicate: string;
  referenceTime: number;
}): readonly CrossAxisFactSpec[] {
  const { taskId, subject, predicate, referenceTime } = options;
  const specs: CrossAxisFactSpec[] = [];

  // Clean fact — should be accepted.
  specs.push({
    factId: "cross_clean_fact",
    label: "clean",
    expectedRejectionReason: "limit_exceeded", // placeholder, not used for clean
    isClean: true,
    projection: buildProjection({
      factId: "cross_clean_fact",
      recordKind: "fact",
      taskId,
      subject,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 1. record_kind_not_fact — recordKind = "candidate"
  specs.push({
    factId: "cross_record_kind",
    label: "record_kind_not_fact",
    expectedRejectionReason: "record_kind_not_fact",
    isClean: false,
    projection: buildProjection({
      factId: "cross_record_kind",
      recordKind: "candidate",
      taskId,
      subject: `${subject}_record_kind`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_record_kind`, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 2. verification_status_not_verified — verificationStatus = "candidate"
  specs.push({
    factId: "cross_verification_status",
    label: "verification_status_not_verified",
    expectedRejectionReason: "verification_status_not_verified",
    isClean: false,
    projection: buildProjection({
      factId: "cross_verification_status",
      recordKind: "fact",
      taskId,
      subject: `${subject}_verification`,
      predicate,
      verificationStatus: "candidate",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_verification`, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 3. future_valid_at — valid_at > referenceTime
  specs.push({
    factId: "cross_future_valid_at",
    label: "future_valid_at",
    expectedRejectionReason: "future_valid_at",
    isClean: false,
    projection: buildProjection({
      factId: "cross_future_valid_at",
      recordKind: "fact",
      taskId,
      subject: `${subject}_future`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime + 1_000,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_future`, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 4. invalidated_at_reference_time — invalid_at <= referenceTime
  specs.push({
    factId: "cross_invalidated",
    label: "invalidated_at_reference_time",
    expectedRejectionReason: "invalidated_at_reference_time",
    isClean: false,
    projection: buildProjection({
      factId: "cross_invalidated",
      recordKind: "fact",
      taskId,
      subject: `${subject}_invalidated`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      invalidAt: referenceTime - 1,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_invalidated`, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 5. expired_at_reference_time — expired_at <= referenceTime
  specs.push({
    factId: "cross_expired",
    label: "expired_at_reference_time",
    expectedRejectionReason: "expired_at_reference_time",
    isClean: false,
    projection: buildProjection({
      factId: "cross_expired",
      recordKind: "fact",
      taskId,
      subject: `${subject}_expired`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      expiredAt: referenceTime - 1,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_expired`, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 6. task_mismatch — taskId mismatch
  specs.push({
    factId: "cross_task_mismatch",
    label: "task_mismatch",
    expectedRejectionReason: "task_mismatch",
    isClean: false,
    projection: buildProjection({
      factId: "cross_task_mismatch",
      recordKind: "fact",
      taskId: `${taskId}_other`,
      subject: `${subject}_task_mismatch`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_task_mismatch`, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 7. subject_mismatch — subject mismatch
  specs.push({
    factId: "cross_subject_mismatch",
    label: "subject_mismatch",
    expectedRejectionReason: "subject_mismatch",
    isClean: false,
    projection: buildProjection({
      factId: "cross_subject_mismatch",
      recordKind: "fact",
      taskId,
      subject: `${subject}_wrong`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 8. predicate_mismatch — predicate mismatch
  specs.push({
    factId: "cross_predicate_mismatch",
    label: "predicate_mismatch",
    expectedRejectionReason: "predicate_mismatch",
    isClean: false,
    projection: buildProjection({
      factId: "cross_predicate_mismatch",
      recordKind: "fact",
      taskId,
      subject: `${subject}_predicate`,
      predicate: `${predicate}_wrong`,
      verificationStatus: "verified",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_predicate`, predicate, referenceTime, tokenBudget: 512, limit: 4 },
  });

  // 9. token_budget_exceeded — clean fact, tokenBudget = 0
  specs.push({
    factId: "cross_token_budget",
    label: "token_budget_exceeded",
    expectedRejectionReason: "token_budget_exceeded",
    isClean: false,
    projection: buildProjection({
      factId: "cross_token_budget",
      recordKind: "fact",
      taskId,
      subject: `${subject}_token_budget`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_token_budget`, predicate, referenceTime, tokenBudget: 0, limit: 4 },
  });

  // 10. limit_exceeded — clean fact, limit = 0
  specs.push({
    factId: "cross_limit",
    label: "limit_exceeded",
    expectedRejectionReason: "limit_exceeded",
    isClean: false,
    projection: buildProjection({
      factId: "cross_limit",
      recordKind: "fact",
      taskId,
      subject: `${subject}_limit`,
      predicate,
      verificationStatus: "verified",
      validAt: referenceTime,
      referenceTime,
    }),
    query: { taskId, subject: `${subject}_limit`, predicate, referenceTime, tokenBudget: 512, limit: 0 },
  });

  return specs;
}

type ProjectionBuilderOptions = {
  factId: string;
  recordKind: "fact" | "candidate";
  taskId: string;
  subject: string;
  predicate: string;
  verificationStatus: string;
  validAt: number;
  invalidAt?: number;
  expiredAt?: number;
  referenceTime: number;
};

function buildProjection(
  options: ProjectionBuilderOptions,
): RuntimeMemoryHydrationShadowFactProjection {
  return {
    factId: options.factId,
    recordKind: options.recordKind,
    taskId: options.taskId,
    subject: options.subject,
    predicate: options.predicate,
    objectSummary: `Cross-axis fact ${options.factId}.`,
    confidence: 0.9,
    source: "verifier_summary",
    verificationStatus: options.verificationStatus,
    valid_at: options.validAt,
    reference_time: options.referenceTime,
    ...(options.invalidAt !== undefined ? { invalid_at: options.invalidAt } : {}),
    ...(options.expiredAt !== undefined ? { expired_at: options.expiredAt } : {}),
    sourceEpisodeRefs: [],
    evidenceRefs: [],
  };
}

export function evaluateCrossAxisRejection(
  scenario: readonly CrossAxisFactSpec[],
  consumerResults: ReadonlyArray<RuntimeMemoryHydrationConsumerResult>,
): CrossAxisRejectionResult {
  if (consumerResults.length !== scenario.length) {
    throw new Error(
      `evaluateCrossAxisRejection: consumerResults.length (${consumerResults.length}) must equal scenario.length (${scenario.length})`,
    );
  }

  const perReason = scenario
    .filter((spec) => !spec.isClean)
    .map((spec) => {
      const index = scenario.indexOf(spec);
      const result = consumerResults[index];
      const rejectedFact = result.rejectedFacts.find(
        (entry) => entry.fact.factId === spec.factId,
      );
      const rejected = rejectedFact !== undefined;
      const actualReason = rejectedFact?.reason;
      const correctReason = actualReason === spec.expectedRejectionReason;
      return {
        reason: spec.expectedRejectionReason,
        factId: spec.factId,
        rejected,
        correctReason,
        actualReason,
      };
    });

  const rejectionSpecs = scenario.filter((spec) => !spec.isClean);
  const firedCount = perReason.filter((entry) => entry.rejected).length;
  const correctCount = perReason.filter((entry) => entry.correctReason).length;

  const cleanSpec = scenario.find((spec) => spec.isClean);
  const cleanIndex = cleanSpec ? scenario.indexOf(cleanSpec) : -1;
  const cleanFactAccepted =
    cleanIndex >= 0 ? consumerResults[cleanIndex].acceptedFacts.length > 0 : false;

  const totalRejectionReasons = rejectionSpecs.length;
  const rejectionCoverage =
    totalRejectionReasons === 0 ? 1 : firedCount / totalRejectionReasons;
  const correctReasonRate =
    totalRejectionReasons === 0 ? 1 : correctCount / totalRejectionReasons;

  return {
    perReason,
    allReasonsFired: firedCount === totalRejectionReasons,
    cleanFactAccepted,
    rejectionCoverage,
    correctReasonRate,
  };
}
