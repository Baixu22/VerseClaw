import {
  isEvidenceRef,
  type EvidenceRef,
} from "./evidence.js";
import {
  isFiniteNumber,
  isOptionalFiniteNumber,
  isOptionalString,
  isRecord,
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
} from "./types.js";
import {
  findRuntimeMemoryFacts,
  isRuntimeMemoryInvalidationProposal,
  isRuntimeMemorySourceEpisodeRef,
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  rejectRawRuntimeMemoryInput,
  resolveRuntimeMemoryFeatureFlags,
  sanitizeRuntimeMemoryInvalidationProposal,
  sanitizeRuntimeMemoryTemporalFact,
  sanitizeRuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryFactSource,
  type RuntimeMemoryFeatureFlags,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryRawInputRejectionReason,
  type RuntimeMemorySensitivity,
  type RuntimeMemorySourceEpisodeRef,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryTemporalFields,
} from "./memory-context.js";
import { assertRuntimeMemoryOwnerConvergence } from "../agents/slot-convergence.js";
import type { RuntimeMemoryRuntimeIntegrationPort } from "./memory-runtime-integration.js";

export const RUNTIME_MEMORY_FACT_PROPOSAL_INPUT_SOURCES = [
  "task_event",
  "tool_result",
  "test_output",
  "verifier_summary",
  "trace_summary",
  "human_confirmation",
  "deterministic_rule",
] as const satisfies readonly RuntimeMemoryFactSource[];

export type RuntimeMemoryFactProposalInputSource =
  typeof RUNTIME_MEMORY_FACT_PROPOSAL_INPUT_SOURCES[number];

export const RUNTIME_MEMORY_FACT_PROPOSAL_REJECTION_REASONS = [
  "raw_input",
  "unsupported_source",
  "accepted_fact_input",
  "invalid_shape",
] as const;

export type RuntimeMemoryFactProposalRejectionReason =
  typeof RUNTIME_MEMORY_FACT_PROPOSAL_REJECTION_REASONS[number];

export type RuntimeMemoryFactProposalInput = RuntimeMemoryTemporalFields & {
  schemaVersion: 1;
  factId: string;
  taskId?: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence?: number;
  source: RuntimeMemoryFactSource;
  sourceEpisodeRefs: RuntimeMemorySourceEpisodeRef[];
  evidenceRefs: EvidenceRef[];
  proposedAt?: number;
  metadata?: RuntimeCoreJsonObject;
  // COMPASS 2.0: Sensitivity level (REDACT 合规门). 可选, 向后兼容.
  sensitivity?: RuntimeMemorySensitivity;
};

export type RuntimeMemoryFactProposalRejection = {
  accepted: false;
  reason: RuntimeMemoryFactProposalRejectionReason;
  inputId?: string;
  rawReason?: RuntimeMemoryRawInputRejectionReason;
  message: string;
};

export type RuntimeMemoryFactProposalShadowParams = {
  config?: unknown;
  inputs?: readonly unknown[];
  acceptedFacts?: readonly RuntimeMemoryTemporalFact[];
};

export type RuntimeMemoryFactProposalShadowResult = {
  enabled: boolean;
  disabledReason?: "runtime_memory_flags_disabled";
  flags: RuntimeMemoryFeatureFlags;
  proposalOnly: true;
  readonly: true;
  candidates: RuntimeMemoryTemporalFactCandidate[];
  acceptedFacts: [];
  invalidationProposals: RuntimeMemoryInvalidationProposal[];
  rejectedInputs: RuntimeMemoryFactProposalRejection[];
};

const PROPOSAL_SOURCE_SET = new Set<RuntimeMemoryFactSource>(
  RUNTIME_MEMORY_FACT_PROPOSAL_INPUT_SOURCES,
);

export function buildRuntimeMemoryFactProposalShadow(
  params: RuntimeMemoryFactProposalShadowParams = {},
): RuntimeMemoryFactProposalShadowResult {
  const flags = resolveRuntimeMemoryFeatureFlags(params.config);
  if (!flags.shadow || !flags.proposeFacts) {
    return emptyProposalShadowResult(flags, "runtime_memory_flags_disabled");
  }

  const acceptedFacts = sanitizeAcceptedFacts(params.acceptedFacts ?? []);
  const candidates: RuntimeMemoryTemporalFactCandidate[] = [];
  const rejectedInputs: RuntimeMemoryFactProposalRejection[] = [];

  for (const input of params.inputs ?? []) {
    const candidate = sanitizeRuntimeMemoryFactProposalInput(input);
    if (candidate.accepted) {
      candidates.push(candidate.value);
    } else {
      rejectedInputs.push(candidate);
    }
  }

  return {
    enabled: true,
    flags,
    proposalOnly: true,
    readonly: true,
    candidates,
    acceptedFacts: [],
    invalidationProposals: proposeRuntimeMemoryInvalidations(
      candidates,
      acceptedFacts,
    ),
    rejectedInputs,
  };
}

/**
 * R3-2.4 proposeFacts confirm: promote a shadow candidate into a durable
 * human-approved fact. The caller then persists it through the P0-B port
 * (memory-runtime-integration appendFact) — never a second authority.
 */
export function promoteRuntimeMemoryFactCandidate(
  candidate: RuntimeMemoryTemporalFactCandidate,
  input: {
    acceptedAt: number;
    approvedBy?: string;
    evidenceRefs: EvidenceRef[];
  },
): RuntimeMemoryTemporalFact {
  const { proposedAt: _proposedAt, verificationStatus: _candidateStatus, ...fact } = candidate;
  void _proposedAt;
  void _candidateStatus;
  return {
    ...fact,
    verificationStatus: "human_approved",
    acceptedAt: input.acceptedAt,
    promotion: {
      promotedBy: "human",
      evidenceRefs: input.evidenceRefs,
      ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy } : {}),
    },
  };
}

export type RuntimeMemoryFactConfirmationResult =
  | { ok: true; fact: RuntimeMemoryTemporalFact; message: string }
  | { ok: false; message: string; fact?: undefined };

/**
 * R3-2.4 proposeFacts confirm: promote a shadow candidate into a durable
 * human-approved fact and persist it through the P0-B appendFact port.
 *
 * Fail-closed per the R3-1 E-1 authority ruling (a): persist=true is legal
 * only when runtime-memory is the selected plugins.slots.memory owner. Callers
 * must pass that selected owner id; omission is treated as the default
 * memory-core owner and is rejected before persisting.
 */
export function confirmRuntimeMemoryFactProposal(input: {
  candidate: RuntimeMemoryTemporalFactCandidate;
  acceptedAt?: number;
  approvedBy?: string;
  evidenceRefs: EvidenceRef[];
  persistence?: RuntimeMemoryRuntimeIntegrationPort;
  /** Selected plugins.slots.memory owner. Defaults to memory-core (fail-closed). */
  memorySlotId?: string;
}): RuntimeMemoryFactConfirmationResult {
  const ownerCheck = assertRuntimeMemoryOwnerConvergence({
    memorySlotId: input.memorySlotId,
    runtimeMemoryPersist: true,
  });
  if (!ownerCheck.ok) {
    return {
      ok: false,
      message: `confirm blocked by E-1 owner convergence: ${ownerCheck.errors.join("; ")}`,
    };
  }
  if (!input.persistence) {
    return { ok: false, message: "no persistence port provided" };
  }
  const fact = promoteRuntimeMemoryFactCandidate(input.candidate, {
    acceptedAt: input.acceptedAt ?? Date.now(),
    ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy } : {}),
    evidenceRefs: input.evidenceRefs,
  });
  const result = input.persistence.appendFact(fact);
  if (result.status === "persisted") {
    return { ok: true, fact, message: "confirmed and persisted" };
  }
  return {
    ok: false,
    message:
      result.status === "rejected"
        ? `persistence rejected: ${result.message}`
        : `persistence skipped (${result.reason})`,
  };
}

export function sanitizeRuntimeMemoryFactProposalInput(
  input: unknown,
):
  | { accepted: true; value: RuntimeMemoryTemporalFactCandidate }
  | RuntimeMemoryFactProposalRejection {
  const rawRejection = rejectRawRuntimeMemoryInput(input);
  if (rawRejection) {
    return makeProposalRejection("raw_input", input, rawRejection.reason);
  }
  if (isAcceptedFactInput(input)) {
    return makeProposalRejection("accepted_fact_input", input);
  }
  if (!isRuntimeMemoryFactProposalInput(input)) {
    return makeProposalRejection("invalid_shape", input);
  }
  if (!PROPOSAL_SOURCE_SET.has(input.source)) {
    return makeProposalRejection("unsupported_source", input);
  }

  const candidate: RuntimeMemoryTemporalFactCandidate = {
    schemaVersion: 1,
    factId: input.factId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    subject: input.subject,
    predicate: input.predicate,
    objectSummary: input.objectSummary,
    confidence: input.confidence ?? defaultProposalConfidence(input.source),
    source: input.source,
    verificationStatus: "candidate",
    valid_at: input.valid_at,
    ...(input.invalid_at !== undefined ? { invalid_at: input.invalid_at } : {}),
    ...(input.expired_at !== undefined ? { expired_at: input.expired_at } : {}),
    reference_time: input.reference_time,
    sourceEpisodeRefs: input.sourceEpisodeRefs,
    evidenceRefs: input.evidenceRefs,
    proposedAt: input.proposedAt ?? input.reference_time,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    // COMPASS 2.0: Sensitivity level (REDACT 合规门).
    ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
  };
  const sanitized = sanitizeRuntimeMemoryTemporalFactCandidate(candidate);
  if (
    sanitized.accepted &&
    isRuntimeMemoryTemporalFactCandidate(sanitized.value)
  ) {
    return sanitized;
  }
  return makeProposalRejection("invalid_shape", input);
}

export function proposeRuntimeMemoryInvalidations(
  candidates: readonly RuntimeMemoryTemporalFactCandidate[],
  acceptedFacts: readonly RuntimeMemoryTemporalFact[],
): RuntimeMemoryInvalidationProposal[] {
  const proposals: RuntimeMemoryInvalidationProposal[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const currentFacts = findRuntimeMemoryFacts(acceptedFacts, {
      subject: candidate.subject,
      predicate: candidate.predicate,
      reference_time: candidate.valid_at,
    }).filter(isRuntimeMemoryTemporalFact);

    for (const fact of currentFacts) {
      if (!runtimeMemoryFactsConflict(candidate, fact)) {
        continue;
      }
      const key = `${fact.factId}\n${candidate.factId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const sanitized = sanitizeRuntimeMemoryInvalidationProposal({
        schemaVersion: 1,
        invalidationId: `runtime-memory-invalidation:${fact.factId}:${candidate.factId}`,
        factId: fact.factId,
        reason: "contradicted",
        invalid_at: candidate.valid_at,
        reference_time: candidate.reference_time,
        proposedBy: candidate.source,
        verificationStatus: "candidate",
        sourceEpisodeRefs: candidate.sourceEpisodeRefs,
        evidenceRefs: candidate.evidenceRefs,
        replacementFactId: candidate.factId,
        metadata: {
          candidateFactId: candidate.factId,
          proposalOnly: true,
        },
      });
      if (
        sanitized.accepted &&
        isRuntimeMemoryInvalidationProposal(sanitized.value)
      ) {
        proposals.push(sanitized.value);
      }
    }
  }

  return proposals;
}

function emptyProposalShadowResult(
  flags: RuntimeMemoryFeatureFlags,
  disabledReason: "runtime_memory_flags_disabled",
): RuntimeMemoryFactProposalShadowResult {
  return {
    enabled: false,
    disabledReason,
    flags,
    proposalOnly: true,
    readonly: true,
    candidates: [],
    acceptedFacts: [],
    invalidationProposals: [],
    rejectedInputs: [],
  };
}

function sanitizeAcceptedFacts(
  facts: readonly RuntimeMemoryTemporalFact[],
): RuntimeMemoryTemporalFact[] {
  return facts.flatMap((fact) => {
    if (!isRuntimeMemoryTemporalFact(fact)) {
      return [];
    }
    const sanitized = sanitizeRuntimeMemoryTemporalFact(fact);
    return sanitized.accepted && isRuntimeMemoryTemporalFact(sanitized.value)
      ? [sanitized.value]
      : [];
  });
}

function isRuntimeMemoryFactProposalInput(
  value: unknown,
): value is RuntimeMemoryFactProposalInput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    nonEmptyString(value.factId) &&
    isOptionalString(value.taskId) &&
    nonEmptyString(value.subject) &&
    nonEmptyString(value.predicate) &&
    nonEmptyString(value.objectSummary) &&
    (value.confidence === undefined || isFiniteNumber(value.confidence)) &&
    typeof value.source === "string" &&
    isFiniteNumber(value.valid_at) &&
    isOptionalFiniteNumber(value.invalid_at) &&
    isOptionalFiniteNumber(value.expired_at) &&
    isFiniteNumber(value.reference_time) &&
    (value.proposedAt === undefined || isFiniteNumber(value.proposedAt)) &&
    Array.isArray(value.sourceEpisodeRefs) &&
    value.sourceEpisodeRefs.length > 0 &&
    value.sourceEpisodeRefs.every(isRuntimeMemorySourceEpisodeRef) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.length > 0 &&
    value.evidenceRefs.every(isEvidenceRef) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

function isAcceptedFactInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.verificationStatus !== undefined &&
    value.verificationStatus !== "candidate"
  );
}

function runtimeMemoryFactsConflict(
  candidate: RuntimeMemoryTemporalFactCandidate,
  fact: RuntimeMemoryTemporalFact,
): boolean {
  if (
    candidate.taskId !== undefined &&
    fact.taskId !== undefined &&
    candidate.taskId !== fact.taskId
  ) {
    return false;
  }
  return (
    normalizeFactText(candidate.objectSummary) !==
      normalizeFactText(fact.objectSummary)
  );
}

function makeProposalRejection(
  reason: RuntimeMemoryFactProposalRejectionReason,
  input: unknown,
  rawReason?: RuntimeMemoryRawInputRejectionReason,
): RuntimeMemoryFactProposalRejection {
  const inputId = isRecord(input) && typeof input.factId === "string"
    ? input.factId
    : undefined;
  return {
    accepted: false,
    reason,
    ...(inputId ? { inputId } : {}),
    ...(rawReason ? { rawReason } : {}),
    message: `Runtime memory fact proposal rejected: ${reason}.`,
  };
}

function defaultProposalConfidence(
  source: RuntimeMemoryFactSource,
): number {
  if (source === "human_confirmation") return 0.9;
  if (source === "deterministic_rule") return 0.85;
  if (source === "verifier_summary") return 0.75;
  if (source === "test_output" || source === "tool_result") return 0.7;
  return 0.6;
}

function normalizeFactText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
