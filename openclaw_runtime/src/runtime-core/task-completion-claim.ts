/**
 * A3 completion admission: turn existing owner receipts into at most one
 * Task Ledger completion transition candidate. This module does not write the
 * ledger and does not decide completion by itself.
 */
import type { VerifierCompletionRecord } from "./verifier-completion-verdict.js";

export type TaskCompletionEffectReceipt = {
  taskId: string;
  candidateDigest: string;
  generation: string;
  status: "applied" | "unknown" | "failed" | "cancelled";
  evidenceDigest: string;
  source: "effect-owner";
};

export type TaskCompletionVerificationReceipt =
  VerifierCompletionRecord & {
    candidateDigest: string;
    generation: string;
  };

export type TaskCompletionClaimInput = {
  taskId: string;
  activeCandidateDigest: string;
  activeGeneration: string;
  verifier: TaskCompletionVerificationReceipt;
  effect: TaskCompletionEffectReceipt;
};

export type TaskCompletionClaimResult =
  | {
    accepted: true;
    transition: { nodeId: string; from: string; to: "done" };
    candidateDigest: string;
    generation: string;
    verifierDigest: string;
    effectDigest: string;
  }
  | { accepted: false; reason: string };

export function admitTaskCompletionClaim(
  input: TaskCompletionClaimInput,
): TaskCompletionClaimResult {
  if (input.taskId !== input.verifier.taskId || input.taskId !== input.effect.taskId) {
    return { accepted: false, reason: "task_mismatch" };
  }
  if (
    input.activeCandidateDigest !== input.verifier.candidateDigest
    || input.activeCandidateDigest !== input.effect.candidateDigest
  ) {
    return { accepted: false, reason: "candidate_mismatch" };
  }
  if (
    input.activeGeneration !== input.verifier.generation
    || input.activeGeneration !== input.effect.generation
  ) {
    return { accepted: false, reason: "generation_mismatch" };
  }
  if (input.verifier.verdict !== "approved") {
    return { accepted: false, reason: "verifier_not_approved" };
  }
  if (input.effect.source !== "effect-owner" || input.effect.status !== "applied") {
    return { accepted: false, reason: "effect_not_applied" };
  }
  if (input.verifier.evidenceDigest !== input.effect.evidenceDigest) {
    return { accepted: false, reason: "evidence_mismatch" };
  }
  if (input.verifier.priorStatus === "done") {
    return { accepted: false, reason: "already_done" };
  }
  return {
    accepted: true,
    transition: { nodeId: input.taskId, from: input.verifier.priorStatus, to: "done" },
    candidateDigest: input.activeCandidateDigest,
    generation: input.activeGeneration,
    verifierDigest: input.verifier.evidenceDigest,
    effectDigest: input.effect.evidenceDigest,
  };
}
