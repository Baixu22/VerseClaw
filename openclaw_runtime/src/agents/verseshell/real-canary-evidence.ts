import { createHash } from "node:crypto";
import { z } from "zod";
import {
  summarizeUas06Canary,
  type Uas06CanaryObservation,
  type Uas06CanarySummary,
  type Uas06ProviderUsage,
} from "./single-plane-canary.js";

export const UAS06_LIVE_OBSERVATIONS_SCHEMA = "uas-06.live-observations/v1" as const;
export const UAS06_REAL_COHORT_REPORT_SCHEMA = "uas-06.real-cohort-evidence/v1" as const;

const opaqueId = z.string().trim().regex(/^[A-Za-z0-9._:-]{2,160}$/u);
const sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const reviewedAt = z.string().datetime({ offset: true });
const finiteNonNegative = z.number().finite().nonnegative();

const providerUsageSchema = z
  .object({
    inputTokens: finiteNonNegative,
    outputTokens: finiteNonNegative,
    cacheReadTokens: finiteNonNegative,
    cacheWriteTokens: finiteNonNegative,
    costUsd: finiteNonNegative,
    actual: z.literal(true),
  })
  .strict();

const observationSchema = z
  .object({
    observationId: opaqueId,
    source: z.literal("live"),
    cohortId: opaqueId,
    cohortArm: z.enum(["baseline", "verseshell"]),
    scenario: z.enum([
      "short",
      "long",
      "background",
      "stdin",
      "pty",
      "cancel",
      "timeout",
      "restart",
      "rollback",
    ]),
    pairedTaskId: opaqueId.optional(),
    eligibleLocal: z.boolean(),
    executionHost: z.enum(["gateway", "sandbox", "node", "verseshell"]),
    lifecycleOwner: z.enum(["native", "sandbox", "node", "verseshell", "legacy-verseshell"]),
    nativeFallback: z.boolean(),
    outcome: z.enum(["completed", "failed"]),
    durationMs: finiteNonNegative,
    recoveryState: z.enum([
      "none",
      "start-failed",
      "exited",
      "killed",
      "lost",
      "runtime-error",
    ]),
    unauthorizedExecutionCount: finiteNonNegative,
    duplicateProcessCount: finiteNonNegative,
    lostOutputBytes: finiteNonNegative,
    sensitiveOutputLeakCount: finiteNonNegative,
    rollbackSucceeded: z.boolean().optional(),
    operatorReviewed: z.literal(true),
    providerUsage: providerUsageSchema,
    humanRecoveryMinutes: finiteNonNegative,
  })
  .strict();

const diagnosticEventSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    timestampMs: z.number().int().nonnegative(),
    type: z.literal("exec.process.completed"),
    target: z.literal("host"),
    selectedHost: z.enum(["gateway", "verseshell"]),
    executionHost: z.enum(["gateway", "verseshell"]),
    lifecycleOwner: z.enum(["native", "verseshell", "legacy-verseshell"]),
    cohortRoute: z.literal("verseshell-single-plane").optional(),
    nativeFallback: z.boolean(),
    recoveryState: z.enum([
      "none",
      "start-failed",
      "exited",
      "killed",
      "lost",
      "runtime-error",
    ]),
    outcome: z.enum(["completed", "failed"]),
    durationMs: finiteNonNegative,
  })
  .strict();

const diagnosticEvidenceSchema = z
  .object({
    source: z.literal("diagnostics.stability"),
    capturedAt: reviewedAt,
    window: z
      .object({
        sinceSeq: z.number().int().nonnegative(),
        lastSeq: z.number().int().nonnegative(),
        dropped: z.number().int().nonnegative(),
      })
      .strict(),
    event: diagnosticEventSchema,
    recordDigest: sha256Digest,
  })
  .strict();

const providerReceiptSchema = z
  .object({
    source: z.enum(["provider-api", "provider-billing-export", "provider-console"]),
    provider: opaqueId,
    model: opaqueId,
    receiptRef: opaqueId,
    capturedAt: reviewedAt,
    receiptDigest: sha256Digest,
    usage: providerUsageSchema,
  })
  .strict();

const humanReviewSchema = z
  .object({
    reviewerId: opaqueId,
    reviewedAt,
    humanRecoveryMinutes: finiteNonNegative,
    attestationDigest: sha256Digest,
  })
  .strict();

const rollbackReviewSchema = z
  .object({
    reviewerId: opaqueId,
    reviewedAt,
    killSwitchEngaged: z.literal(true),
    priorHost: z.enum(["auto", "gateway", "sandbox", "node"]),
    restoredHost: z.enum(["auto", "gateway", "sandbox", "node"]),
    attestationDigest: sha256Digest,
  })
  .strict();

const liveEvidenceRecordSchema = z
  .object({
    observation: observationSchema,
    diagnostic: diagnosticEvidenceSchema,
    providerReceipt: providerReceiptSchema,
    humanReview: humanReviewSchema,
    rollbackReview: rollbackReviewSchema.optional(),
  })
  .strict();

const liveObservationsDocumentSchema = z
  .object({
    schema: z.literal(UAS06_LIVE_OBSERVATIONS_SCHEMA),
    cohortId: opaqueId.optional(),
    observations: z.array(liveEvidenceRecordSchema),
  })
  .strict();

export type Uas06DiagnosticEventEvidence = z.infer<typeof diagnosticEventSchema>;
export type Uas06DiagnosticEvidence = z.infer<typeof diagnosticEvidenceSchema>;
export type Uas06ProviderReceipt = z.infer<typeof providerReceiptSchema>;
export type Uas06HumanReview = z.infer<typeof humanReviewSchema>;
export type Uas06RollbackReview = z.infer<typeof rollbackReviewSchema>;
export type Uas06LiveEvidenceRecord = z.infer<typeof liveEvidenceRecordSchema>;
export type Uas06LiveObservationsDocument = z.infer<typeof liveObservationsDocumentSchema>;

export const UAS06_FROZEN_LOCKS = {
  liveReady: false,
  productApproved: false,
  defaultOn: false,
  tf0006: "blocked",
  tf0009: "review_needed",
  tf0018: "proposed",
  tf0019: "proposed",
  runtimeMemory: "diagnostics-only",
  sekbAutoWriteback: false,
} as const;

export type Uas06LiveEvidenceValidation = {
  document?: Uas06LiveObservationsDocument;
  issues: string[];
};

export type Uas06EvidenceSourceInventoryEntry = {
  path: string;
  bytes: number;
  sha256: string;
};

export type Uas06RealCohortReport = {
  schema: typeof UAS06_REAL_COHORT_REPORT_SCHEMA;
  generatedAt: string;
  taskForestNode: "TF-0017";
  taskSpec: "harness/specs/tasks/uas-06-single-local-exec-canary.md";
  qualification: "no-live-observations" | "reviewed-live-evidence";
  sourceEvidence: {
    liveObservations: {
      path: "artifacts/uas-06-single-local-exec-canary/live-observations.json";
      sha256: string;
    };
    engineeringReport: {
      path: "artifacts/uas-06-single-local-exec-canary/report.json";
      sha256: string;
      qualification: "engineering-only";
    };
  };
  sourceInventory: Uas06EvidenceSourceInventoryEntry[];
  summary: Uas06CanarySummary;
  evidenceCounts: {
    liveObservations: number;
    diagnosticsWindows: number;
    providerReceipts: number;
    humanReviews: number;
    reviewedRollbackDrills: number;
  };
  closeout: {
    eligibleForTaskForestReview: boolean;
    taskForestCloseoutAuthorized: false;
    productGraduationAuthorized: false;
    requiredNextAction: string;
  };
  frozenLocks: typeof UAS06_FROZEN_LOCKS;
};

function sameUsage(left: Uas06ProviderUsage, right: Uas06ProviderUsage): boolean {
  return (
    left.actual === right.actual &&
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens &&
    left.costUsd === right.costUsd
  );
}

function diagnosticDigestPayload(evidence: Omit<Uas06DiagnosticEvidence, "recordDigest">) {
  return {
    source: evidence.source,
    capturedAt: evidence.capturedAt,
    window: {
      sinceSeq: evidence.window.sinceSeq,
      lastSeq: evidence.window.lastSeq,
      dropped: evidence.window.dropped,
    },
    event: {
      seq: evidence.event.seq,
      timestampMs: evidence.event.timestampMs,
      type: evidence.event.type,
      target: evidence.event.target,
      selectedHost: evidence.event.selectedHost,
      executionHost: evidence.event.executionHost,
      lifecycleOwner: evidence.event.lifecycleOwner,
      ...(evidence.event.cohortRoute ? { cohortRoute: evidence.event.cohortRoute } : {}),
      nativeFallback: evidence.event.nativeFallback,
      recoveryState: evidence.event.recoveryState,
      outcome: evidence.event.outcome,
      durationMs: evidence.event.durationMs,
    },
  };
}

/** Hashes the low-sensitivity diagnostic window retained with a live observation. */
export function digestUas06DiagnosticEvidence(
  evidence: Omit<Uas06DiagnosticEvidence, "recordDigest">,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(diagnosticDigestPayload(evidence)))
    .digest("hex")}`;
}

function schemaIssuePaths(input: unknown): Uas06LiveEvidenceValidation {
  const parsed = liveObservationsDocumentSchema.safeParse(input);
  if (parsed.success) {
    return { document: parsed.data, issues: [] };
  }
  return {
    issues: parsed.error.issues.slice(0, 20).map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "document";
      return `invalid:${path}`;
    }),
  };
}

function validateRecord(record: Uas06LiveEvidenceRecord, index: number): string[] {
  const issues: string[] = [];
  const prefix = `observations.${index}`;
  const { observation, diagnostic, providerReceipt, humanReview, rollbackReview } = record;

  if (diagnostic.window.dropped !== 0) issues.push(`${prefix}.diagnostic.window.dropped`);
  if (
    diagnostic.event.seq <= diagnostic.window.sinceSeq ||
    diagnostic.event.seq > diagnostic.window.lastSeq
  ) {
    issues.push(`${prefix}.diagnostic.window.bounds`);
  }
  if (
    diagnostic.recordDigest !==
    digestUas06DiagnosticEvidence({
      source: diagnostic.source,
      capturedAt: diagnostic.capturedAt,
      window: diagnostic.window,
      event: diagnostic.event,
    })
  ) {
    issues.push(`${prefix}.diagnostic.recordDigest`);
  }
  if (
    diagnostic.event.executionHost !== observation.executionHost ||
    diagnostic.event.lifecycleOwner !== observation.lifecycleOwner ||
    diagnostic.event.nativeFallback !== observation.nativeFallback ||
    diagnostic.event.recoveryState !== observation.recoveryState ||
    diagnostic.event.outcome !== observation.outcome ||
    diagnostic.event.durationMs !== observation.durationMs
  ) {
    issues.push(`${prefix}.diagnostic.observationMismatch`);
  }
  if (diagnostic.event.selectedHost !== observation.executionHost) {
    issues.push(`${prefix}.diagnostic.selectedHost`);
  }
  if (
    (observation.cohortArm === "verseshell" &&
      diagnostic.event.cohortRoute !== "verseshell-single-plane") ||
    (observation.cohortArm === "baseline" && diagnostic.event.cohortRoute !== undefined)
  ) {
    issues.push(`${prefix}.diagnostic.cohortRoute`);
  }
  if (!sameUsage(observation.providerUsage, providerReceipt.usage)) {
    issues.push(`${prefix}.providerReceipt.usageMismatch`);
  }
  if (observation.humanRecoveryMinutes !== humanReview.humanRecoveryMinutes) {
    issues.push(`${prefix}.humanReview.recoveryMismatch`);
  }
  if (observation.scenario === "rollback") {
    if (!observation.rollbackSucceeded || !rollbackReview) {
      issues.push(`${prefix}.rollbackReview`);
    }
  } else if (rollbackReview !== undefined) {
    issues.push(`${prefix}.rollbackReview.unexpected`);
  }
  return issues;
}

/**
 * Validates only reviewed, low-sensitivity live records. Raw prompts, commands,
 * transcripts, provider credentials, and provider receipts remain outside this artifact.
 */
export function validateUas06LiveEvidence(input: unknown): Uas06LiveEvidenceValidation {
  const parsed = schemaIssuePaths(input);
  if (!parsed.document) return parsed;

  const { document } = parsed;
  const issues: string[] = [];
  const observationIds = new Set<string>();
  const diagnosticSequences = new Set<number>();

  if (document.observations.length > 0 && !document.cohortId) {
    issues.push("cohortId");
  }
  for (const [index, record] of document.observations.entries()) {
    issues.push(...validateRecord(record, index));
    if (document.cohortId !== record.observation.cohortId) {
      issues.push(`observations.${index}.cohortId`);
    }
    if (observationIds.has(record.observation.observationId)) {
      issues.push(`observations.${index}.observationId.duplicate`);
    }
    observationIds.add(record.observation.observationId);
    if (diagnosticSequences.has(record.diagnostic.event.seq)) {
      issues.push(`observations.${index}.diagnostic.event.seq.duplicate`);
    }
    diagnosticSequences.add(record.diagnostic.event.seq);
  }
  return { document, issues: [...new Set(issues)].toSorted() };
}

export function assertValidUas06LiveEvidence(input: unknown): Uas06LiveObservationsDocument {
  const validation = validateUas06LiveEvidence(input);
  if (!validation.document || validation.issues.length > 0) {
    const details = validation.issues.slice(0, 20).join(", ") || "invalid document";
    throw new Error(`UAS-06 live evidence rejected: ${details}`);
  }
  return validation.document;
}

export function buildUas06RealCohortReport(params: {
  document: unknown;
  engineeringObservations: readonly Uas06CanaryObservation[];
  generatedAt: string;
  liveObservationsSha256: string;
  engineeringReportSha256: string;
  sourceInventory: readonly Uas06EvidenceSourceInventoryEntry[];
}): Uas06RealCohortReport {
  const document = assertValidUas06LiveEvidence(params.document);
  const liveObservations = document.observations.map((record) => record.observation);
  const summary = summarizeUas06Canary([...params.engineeringObservations, ...liveObservations]);
  const reviewedRollbackDrills = document.observations.filter(
    (record) =>
      record.observation.scenario === "rollback" &&
      record.observation.rollbackSucceeded === true &&
      record.rollbackReview !== undefined,
  ).length;
  const eligibleForTaskForestReview = summary.status === "eligible-for-closeout-review";

  return {
    schema: UAS06_REAL_COHORT_REPORT_SCHEMA,
    generatedAt: params.generatedAt,
    taskForestNode: "TF-0017",
    taskSpec: "harness/specs/tasks/uas-06-single-local-exec-canary.md",
    qualification:
      liveObservations.length === 0 ? "no-live-observations" : "reviewed-live-evidence",
    sourceEvidence: {
      liveObservations: {
        path: "artifacts/uas-06-single-local-exec-canary/live-observations.json",
        sha256: params.liveObservationsSha256,
      },
      engineeringReport: {
        path: "artifacts/uas-06-single-local-exec-canary/report.json",
        sha256: params.engineeringReportSha256,
        qualification: "engineering-only",
      },
    },
    sourceInventory: params.sourceInventory.map((entry) => ({ ...entry })),
    summary,
    evidenceCounts: {
      liveObservations: liveObservations.length,
      diagnosticsWindows: document.observations.length,
      providerReceipts: document.observations.length,
      humanReviews: document.observations.length,
      reviewedRollbackDrills,
    },
    closeout: {
      eligibleForTaskForestReview,
      taskForestCloseoutAuthorized: false,
      productGraduationAuthorized: false,
      requiredNextAction: eligibleForTaskForestReview
        ? "independent evidence review and explicit Task Forest closeout confirmation"
        : "collect additional reviewed real cohort evidence",
    },
    frozenLocks: UAS06_FROZEN_LOCKS,
  };
}
