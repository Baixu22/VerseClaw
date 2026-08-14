import { createHash } from "node:crypto";
import type { EvidenceRef } from "./evidence.js";
import {
  resolveRuntimeMemoryFeatureFlags,
  type RuntimeMemoryFactSource,
  type RuntimeMemorySourceEpisodeRef,
} from "./memory-context.js";
import {
  buildRuntimeMemoryFactProposalShadow,
  type RuntimeMemoryFactProposalInput,
  type RuntimeMemoryFactProposalShadowResult,
} from "./memory-proposal-shadow.js";

/**
 * KE-P1-1: task-terminal candidate generation (failure-guard first).
 *
 * Produces 0-3 candidates from real trajectory/receipt evidence at task
 * termination. Candidates are LearningEnvelope/v1 fact-path subsets (P0 §9
 * 派单附注 R3-2) and error-card proposals. Nothing here is auto-persisted:
 * promotion stays human, and the generator is pure (no DB, no policy mutation).
 *
 * Fail-closed: the flag gates everything. Off => zero candidates, zero writes.
 */

export const KE_CANDIDATE_SCHEMA_VERSION = 1 as const;

export type KeCandidateSensitivity = "normal" | "secret_adjacent" | "secret";

export type KeValidity = {
  validAt: number;
  invalidAt?: number;
  expiresAt?: number;
};

/**
 * LearningEnvelope/v1 fact-path subset. Exactly the fields P0 §9 requires; the
 * absence of activationStatus is deliberate (candidate => disabled ceiling).
 */
export type KeFactCandidateEnvelope = {
  envelopeId: string;
  kind: "fact";
  contentRef: string;
  sourceRefs: string[];
  evidenceDigest: string;
  verificationStatus: "candidate";
  sensitivity: KeCandidateSensitivity;
  validity: KeValidity;
  schemaVersion: 1;
  contentVersion: string;
};

/** Error-card proposal (failure-guard or L4). proposalOnly means L4: never auto-apply. */
export type KeErrorCardProposal = {
  envelopeId: string;
  kind: "error_card";
  trigger: string;
  rootCause: string;
  resolution: string;
  verification: string;
  sourceRefs: string[];
  verificationStatus: "candidate";
  sensitivity: KeCandidateSensitivity;
  schemaVersion: 1;
  contentVersion: string;
  proposalOnly: boolean;
};

/** Deterministic fact evidence extracted from real task result (not model self-report). */
export type KeFactEvidence = {
  subject: string;
  predicate: string;
  objectSummary: string;
  source: string;
};

export type KeTaskTerminalEvidence = {
  taskId: string;
  taskType: string;
  terminalReason: string;
  error?: string;
  /** Prior failures with the same error signature (0 => this is the 1st failure). */
  priorFailureCount: number;
  /** Explicit user correction tied to this task (P0 §6: forbidden substitute = silence). */
  userCorrection: boolean;
  sourceRefs: string[];
  /** Deterministic facts extracted from real evidence (tool/test/user-correction). */
  facts?: KeFactEvidence[];
  now?: number;
};

export type KeCandidateGenerationResult = {
  enabled: boolean;
  disabledReason?: "flag_disabled";
  factCandidates: KeFactCandidateEnvelope[];
  errorCardProposals: KeErrorCardProposal[];
  failureGuardTriggered: boolean;
  errorSignature?: string;
  rejectionReasons: string[];
};

const MAX_CANDIDATES = 3;

const FAILURE_REASONS = new Set([
  "failed",
  "blocked",
  "timed_out",
  "hard_timeout",
  "aborted",
]);

const L4_MARKERS = [
  "system prompt",
  "system_prompt",
  "tool routing",
  "tool_routing",
  "permission",
  "approval",
  "retry policy",
  "retry_policy",
];

const SECRET_MARKERS = [
  "api_key",
  "apikey",
  "api key",
  "password",
  "secret",
  "token=",
  "bearer ",
  "authorization",
];

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function digest(text: string): string {
  return `sha256:${sha256Hex(text)}`;
}

function isFailureReason(reason: string): boolean {
  return FAILURE_REASONS.has(reason);
}

/** Normalize an error message into a stable, volatile-free fingerprint. */
function normalizeError(error: string): string {
  return error
    .split("\n")[0]!
    .trim()
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/[a-z]:[\\/][^\s]*/gi, "<path>")
    .replace(/[\\/][^\s]*/g, "<path>")
    .replace(/\s+/g, " ");
}

/** Stable error signature from terminal reason + task type + normalized error. */
export function extractKeErrorSignature(params: {
  terminalReason: string;
  error?: string;
  taskType: string;
}): string | undefined {
  if (!isFailureReason(params.terminalReason)) {
    return undefined;
  }
  if (!params.error || !params.error.trim()) {
    return undefined;
  }
  const normalized = normalizeError(params.error);
  return `ke-error:${params.taskType}:${params.terminalReason}:${sha256Hex(normalized).slice(0, 16)}`;
}

function touchesL4(...texts: string[]): boolean {
  const joined = texts.join(" ").toLowerCase();
  return L4_MARKERS.some((marker) => joined.includes(marker));
}

function classifySensitivity(...texts: string[]): KeCandidateSensitivity {
  const joined = texts.join(" ").toLowerCase();
  if (SECRET_MARKERS.some((marker) => joined.includes(marker))) {
    return "secret";
  }
  if (/[a-z]:[\\/]|[\\/][^\s]*\.[a-z]+/i.test(joined)) {
    return "secret_adjacent";
  }
  return "normal";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildFactCandidate(
  fact: KeFactEvidence,
  evidence: KeTaskTerminalEvidence,
  now: number,
): KeFactCandidateEnvelope | undefined {
  if (!nonEmpty(fact.subject) || !nonEmpty(fact.predicate) || !nonEmpty(fact.objectSummary)) {
    return undefined;
  }
  const content = `${fact.subject} ${fact.predicate} ${fact.objectSummary}`;
  const contentVersion = digest(content);
  const envelopeId = `runtime_memory:fact:${sha256Hex(content).slice(0, 12)}`;
  return {
    envelopeId,
    kind: "fact",
    contentRef: `ref:memory:${envelopeId}#${contentVersion}`,
    sourceRefs: evidence.sourceRefs,
    evidenceDigest: digest([...evidence.sourceRefs, content].join("\n")),
    verificationStatus: "candidate",
    sensitivity: classifySensitivity(content),
    validity: { validAt: now },
    schemaVersion: 1,
    contentVersion,
  };
}

function buildErrorCard(
  evidence: KeTaskTerminalEvidence,
  errorSignature: string | undefined,
  repeatFailure: boolean,
  userCorrection: boolean,
): KeErrorCardProposal {
  const error = evidence.error ?? "";
  const trigger = repeatFailure
    ? `repeated failure (${errorSignature ?? "unknown"})`
    : userCorrection
      ? "explicit user correction"
      : "failure";
  const proposalOnly = touchesL4(error);
  const content = `${trigger}\n${error.trim()}`;
  return {
    envelopeId: `error_card:${sha256Hex(content).slice(0, 12)}`,
    kind: "error_card",
    trigger,
    rootCause: errorSignature ?? "user_correction",
    resolution: "",
    verification: "",
    sourceRefs: evidence.sourceRefs,
    verificationStatus: "candidate",
    sensitivity: classifySensitivity(error),
    schemaVersion: 1,
    contentVersion: digest(content),
    proposalOnly,
  };
}

export function generateKeTaskTerminalCandidates(
  config: unknown,
  evidence: KeTaskTerminalEvidence,
): KeCandidateGenerationResult {
  const flags = resolveRuntimeMemoryFeatureFlags(config);
  if (!flags.candidateGeneration) {
    return {
      enabled: false,
      disabledReason: "flag_disabled",
      factCandidates: [],
      errorCardProposals: [],
      failureGuardTriggered: false,
      rejectionReasons: [],
    };
  }

  const now = evidence.now ?? Date.now();
  const errorSignature = extractKeErrorSignature({
    terminalReason: evidence.terminalReason,
    error: evidence.error,
    taskType: evidence.taskType,
  });
  const repeatFailure =
    isFailureReason(evidence.terminalReason) &&
    errorSignature !== undefined &&
    evidence.priorFailureCount >= 1;
  const userCorrection = evidence.userCorrection === true;
  const failureGuardTriggered = repeatFailure || userCorrection;

  const factCandidates: KeFactCandidateEnvelope[] = [];
  const errorCardProposals: KeErrorCardProposal[] = [];
  const rejectionReasons: string[] = [];

  if (failureGuardTriggered) {
    errorCardProposals.push(
      buildErrorCard(evidence, errorSignature, repeatFailure, userCorrection),
    );
  }

  for (const fact of evidence.facts ?? []) {
    if (factCandidates.length + errorCardProposals.length >= MAX_CANDIDATES) {
      break;
    }
    const candidate = buildFactCandidate(fact, evidence, now);
    if (candidate) {
      factCandidates.push(candidate);
    } else {
      rejectionReasons.push(`fact evidence missing subject/predicate/objectSummary: ${JSON.stringify(fact)}`);
    }
  }

  return {
    enabled: true,
    factCandidates,
    errorCardProposals,
    failureGuardTriggered,
    ...(errorSignature !== undefined ? { errorSignature } : {}),
    rejectionReasons,
  };
}

/**
 * Convert deterministic fact evidence into proposeFacts shadow inputs. The
 * shadow (buildRuntimeMemoryFactProposalShadow) sanitizes and validates each
 * input and returns proposalOnly/readonly candidates with acceptedFacts: [].
 * This is the KE-P1-1 reuse of the existing proposeFacts chain — no new store.
 */
export function buildKeFactProposalInputs(
  evidence: KeTaskTerminalEvidence,
): RuntimeMemoryFactProposalInput[] {
  const referenceTime = evidence.now ?? Date.now();
  const sourceEpisodeRefs: RuntimeMemorySourceEpisodeRef[] = evidence.sourceRefs.map(
    (ref) => ({ episodeId: ref, taskId: evidence.taskId }),
  );
  const evidenceRefs: EvidenceRef[] = evidence.sourceRefs.map((ref) => ({
    type: "task_ledger",
    ref,
  }));

  const inputs: RuntimeMemoryFactProposalInput[] = [];
  for (const fact of evidence.facts ?? []) {
    if (!nonEmpty(fact.subject) || !nonEmpty(fact.predicate) || !nonEmpty(fact.objectSummary)) {
      continue;
    }
    const content = `${fact.subject} ${fact.predicate} ${fact.objectSummary}`;
    inputs.push({
      schemaVersion: 1,
      factId: `fact_${sha256Hex(content).slice(0, 12)}`,
      taskId: evidence.taskId,
      subject: fact.subject,
      predicate: fact.predicate,
      objectSummary: fact.objectSummary,
      source: fact.source as RuntimeMemoryFactSource,
      sourceEpisodeRefs,
      evidenceRefs,
      valid_at: referenceTime,
      reference_time: referenceTime,
    });
  }
  return inputs;
}

export type KeCandidateGenerationRun = {
  enabled: boolean;
  disabledReason?: "flag_disabled";
  factCandidates: KeFactCandidateEnvelope[];
  errorCardProposals: KeErrorCardProposal[];
  /** proposeFacts shadow output; acceptedFacts is always empty (never auto-persisted). */
  proposalShadow: RuntimeMemoryFactProposalShadowResult;
};

/**
 * Terminal-hook wiring: generate candidates, then feed fact evidence through
 * the existing proposeFacts shadow. Flag off => zero candidates and zero
 * shadow inputs (fail-closed). Candidates are never promoted here.
 */
export function runKeCandidateGeneration(
  config: unknown,
  evidence: KeTaskTerminalEvidence,
): KeCandidateGenerationRun {
  const generation = generateKeTaskTerminalCandidates(config, evidence);
  if (!generation.enabled) {
    return {
      enabled: false,
      disabledReason: "flag_disabled",
      factCandidates: [],
      errorCardProposals: [],
      proposalShadow: buildRuntimeMemoryFactProposalShadow({ config, inputs: [] }),
    };
  }
  return {
    enabled: true,
    factCandidates: generation.factCandidates,
    errorCardProposals: generation.errorCardProposals,
    proposalShadow: buildRuntimeMemoryFactProposalShadow({
      config,
      inputs: buildKeFactProposalInputs(evidence),
    }),
  };
}
/** Map a TaskLoop terminal status to the agent-run terminal reason vocabulary. */
export function mapTaskLoopStatusToTerminalReason(status: string): string {
  switch (status) {
    case "complete":
      return "completed";
    case "blocked":
      return "blocked";
    case "error":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      // Fail-closed: an unknown terminal status is treated as failure, never success.
      return "failed";
  }
}

/** Terminal data a task-loop / task-registry hook can supply from REAL run state. */
export type KeTerminalInput = {
  taskId: string;
  taskType?: string;
  /** TaskLoop status: "complete" | "blocked" | "error" | "cancelled" | ... */
  status: string;
  error?: string;
  sourceRefs: string[];
  /** Prior failures with the same error signature (cross-task history; injected by the caller). */
  priorFailureCount?: number;
  /** Explicit user correction tied to this task (injected by the caller). */
  userCorrection?: boolean;
  now?: number;
};

/**
 * Build candidate-generation evidence from REAL terminal run state (status +
 * error + evidence refs), never from model self-report. priorFailureCount and
 * userCorrection are injected by the caller that owns task history / messages.
 */
export function buildKeTaskTerminalEvidence(terminal: KeTerminalInput): KeTaskTerminalEvidence {
  return {
    taskId: terminal.taskId,
    taskType: terminal.taskType ?? "task_loop",
    terminalReason: mapTaskLoopStatusToTerminalReason(terminal.status),
    error: terminal.error,
    priorFailureCount: terminal.priorFailureCount ?? 0,
    userCorrection: terminal.userCorrection ?? false,
    sourceRefs: terminal.sourceRefs,
    now: terminal.now,
  };
}

/**
 * Count prior failures whose error signature matches the current one. Used by
 * the terminal hook to feed a real (not default-0) repeat-failure signal; the
 * full cross-task registry query is the caller's source of prior signatures.
 */
export function countKePriorFailures(
  priorErrorSignatures: readonly (string | undefined)[],
  currentSignature: string | undefined,
): number {
  if (!currentSignature) return 0;
  return priorErrorSignatures.filter((signature) => signature === currentSignature).length;
}

/** Observable, content-light summary of a KE-P1-1 candidate generation run. */
export type KeCandidateGenerationDiagnostics = {
  enabled: true;
  factCandidateCount: number;
  errorCardProposalCount: number;
  failureGuardTriggered: boolean;
  envelopeIds: string[];
};

/**
 * Terminal-hook entry: build evidence from real terminal state and run the
 * candidate generation (flag-gated, pure). Returns a disabled run when the
 * flag is off; the caller records nothing in that case (zero behavior).
 */
export function runKeCandidateGenerationForTerminal(
  config: unknown,
  terminal: KeTerminalInput,
): KeCandidateGenerationRun {
  return runKeCandidateGeneration(config, buildKeTaskTerminalEvidence(terminal));
}

/** Reduce a run to the observable diagnostic the terminal hook records. */
export function buildKeCandidateGenerationDiagnostics(
  run: KeCandidateGenerationRun,
): KeCandidateGenerationDiagnostics {
  return {
    enabled: true,
    factCandidateCount: run.factCandidates.length,
    errorCardProposalCount: run.errorCardProposals.length,
    failureGuardTriggered: run.factCandidates.length + run.errorCardProposals.length > 0,
    envelopeIds: [
      ...run.factCandidates.map((c) => c.envelopeId),
      ...run.errorCardProposals.map((c) => c.envelopeId),
    ],
  };
}

/**
 * Runtime-owned shape of an error-card candidate as a knowledge-inbox draft.
 * The electron bridge maps this 1:1 into KnowledgeCreateInboxItemPayload and
 * calls createInboxItem — the cross-process push stays out of the runtime.
 */
export type KeErrorCardInboxDraft = {
  title: string;
  body: string;
  kind: "task-ledger";
  type: "troubleshooting";
  sourceIds: string[];
  sourceRefs: Array<{ id: string; kind: string; label?: string }>;
  tags: string[];
  createdBy: "agent";
  warnings: string[];
  metadata: Record<string, unknown>;
};

/** Map one error-card proposal into a knowledge-inbox draft (content-light). */
export function buildKeErrorCardInboxDraft(
  proposal: KeErrorCardProposal,
): KeErrorCardInboxDraft {
  return {
    title: proposal.trigger,
    body: [proposal.rootCause, proposal.resolution, proposal.verification]
      .filter((part) => part.trim().length > 0)
      .join("\n\n"),
    kind: "task-ledger",
    type: "troubleshooting",
    sourceIds: proposal.sourceRefs,
    sourceRefs: proposal.sourceRefs.map((ref) => ({ id: ref, kind: "task_loop" })),
    tags: [
      "ke-candidate",
      ...(proposal.proposalOnly ? ["l4-proposal-only"] : []),
    ],
    createdBy: "agent",
    warnings: proposal.proposalOnly ? ["L4 proposal-only: never auto-apply"] : [],
    metadata: {
      envelopeId: proposal.envelopeId,
      contentVersion: proposal.contentVersion,
      verificationStatus: proposal.verificationStatus,
      sensitivity: proposal.sensitivity,
      proposalOnly: proposal.proposalOnly,
    },
  };
}

/** Map all error-card proposals into knowledge-inbox drafts. */
export function buildKeErrorCardInboxDrafts(
  proposals: readonly KeErrorCardProposal[],
): KeErrorCardInboxDraft[] {
  return proposals.map(buildKeErrorCardInboxDraft);
}



