/**
 * S07: a bounded, revocable completion-verdict entry for the evidence verifier.
 *
 * The verifier may decide whether *one named task* is complete, and nothing else:
 * - It reuses the existing evidence verifier (`evaluateEvidenceVerifier`) — no
 *   second authority layer.
 * - It is bounded: a task outside the granted scope gets no verdict and no
 *   transition.
 * - It is revocable: an approved completion records the prior status so it can be
 *   reverted.
 * - It grants NO publish / product-lock / release capability, and the record says
 *   so explicitly.
 * The record is digest-only (task id, decision, finding codes, evidence digest);
 * raw evidence content never enters it.
 */
import { createHash } from "node:crypto";

import {
  evaluateEvidenceVerifier,
  type EvidenceVerifierDecision,
  type EvidenceVerifierInput,
  type EvidenceVerifierPolicy,
} from "./evidence-verifier.js";

export type VerifierCompletionVerdict =
  | "approved"
  | "rejected"
  | "insufficient-evidence"
  | "out-of-scope";

/** Bounded grant: only these task ids may receive a completion verdict. */
export type VerifierCompletionScope = {
  taskIds: readonly string[];
};

export type VerifierCompletionRecord = {
  taskId: string;
  verdict: VerifierCompletionVerdict;
  /** Digest-only: sha256 over the verifier's decision + evidence refs + finding codes. */
  evidenceDigest: string;
  findingCodes: string[];
  /** The node's status before an approved transition, so it can be revoked. */
  priorStatus: string;
  /** A completion verdict never authorizes publish/release. */
  grantsPublish: false;
  /** A completion verdict never authorizes changing a product lock. */
  grantsProductLock: false;
};

export type VerifierCompletionTransition =
  | { nodeId: string; from: string; to: "done" }
  | null;

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decisionVerdict(decision: EvidenceVerifierDecision): VerifierCompletionVerdict {
  if (decision === "completed") return "approved";
  if (decision === "insufficient_evidence") return "insufficient-evidence";
  return "rejected";
}

/**
 * Resolve a bounded completion verdict for one task. The verdict never reads or
 * stores raw evidence content — only the digest of the evidence identity.
 */
export function resolveVerifierCompletionVerdict(params: {
  input: EvidenceVerifierInput;
  policy?: EvidenceVerifierPolicy;
  scope: VerifierCompletionScope;
  priorStatus: string;
}): VerifierCompletionRecord {
  const { input, policy, scope, priorStatus } = params;
  const inScope = scope.taskIds.includes(input.taskId);
  const report = inScope ? evaluateEvidenceVerifier(input, policy) : undefined;
  const findingCodes = (report?.findings ?? []).map((finding) => finding.code).sort();
  const evidenceDigest = sha256Text(
    JSON.stringify({
      decision: report?.decision ?? "out-of-scope",
      evidenceRefs: (report?.evidenceRefs ?? []).map((ref) => `${ref.type}:${ref.ref}`).sort(),
      findingCodes,
    }),
  );
  return {
    taskId: input.taskId,
    verdict: inScope ? decisionVerdict(report!.decision) : "out-of-scope",
    evidenceDigest,
    findingCodes,
    priorStatus,
    grantsPublish: false,
    grantsProductLock: false,
  };
}

/** The single status transition an approved verdict may produce (node -> done). */
export function verifierCompletionTransition(
  record: VerifierCompletionRecord,
): VerifierCompletionTransition {
  if (record.verdict !== "approved") return null;
  return { nodeId: record.taskId, from: record.priorStatus, to: "done" };
}

/** Revocation restores the recorded prior status; a non-approved verdict has nothing to revoke. */
export function revokeVerifierCompletionVerdict(
  record: VerifierCompletionRecord,
): { nodeId: string; from: "done"; to: string } | null {
  if (record.verdict !== "approved") return null;
  return { nodeId: record.taskId, from: "done", to: record.priorStatus };
}