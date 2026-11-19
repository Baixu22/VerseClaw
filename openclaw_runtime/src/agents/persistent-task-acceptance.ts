import { createHash } from "node:crypto";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import type {
  TaskCredential,
  TaskEvidence,
  TaskView,
  TaskWriterDelegation,
} from "../../../shared/task-system/types.js";
import { EffectReceiptStore, effectProposalDigest } from "./effect-receipt.js";
import { resolveVerifierCompletionVerdict } from "../runtime-core/verifier-completion-verdict.js";
import { admitTaskCompletionClaim } from "../runtime-core/task-completion-claim.js";
import type { EvidenceRef } from "../runtime-core/evidence.js";
import { getSubagentRunByRunId } from "./subagent-registry-read.js";
import { resolveStructuredVerificationVerdict } from "./orchestration-verifier-report.js";

/** Existing verifier/effect owners consume only freshly read task evidence. */
export function acceptPersistentTask(
  store: TaskSystemStore,
  credential: TaskCredential,
  candidate: string,
): TaskView {
  const view = store.get(credential.taskNodeId);
  if (view.contract.state === "done") return store.accept(credential, candidate);
  store.assertOwner(credential);
  if (view.contract.state !== "review") throw new Error("TASK_SUBMISSION_REQUIRED");
  for (const criterion of view.contract.acceptance) {
    const verification = criterion.verification;
    if (verification.kind !== "owner-receipt") continue;
    let evidence: TaskEvidence[] = [];
    let artifacts: Array<{ path: string; sha256: string }>;
    let verifierRunId: string | undefined;
    if (verification.owner === "evidence-verifier") {
      const requires = verification.requires ?? [];
      if (
        !requires.length ||
        requires.some(
          (id) =>
            !view.contract.acceptance.some(
              (c) => c.id === id && c.verification.kind !== "owner-receipt",
            ),
        )
      )
        throw new Error("TASK_VERIFIER_REQUIREMENTS_INVALID");
      evidence = store.validatedEvidence(credential, candidate, requires);
      artifacts = evidence.flatMap((e) => e.inputArtifacts ?? [{ path: e.path, sha256: e.sha256 }]);
    } else if (verification.owner === "subagent-verifier") {
      if (!verification.files?.length) throw new Error("TASK_VERIFIER_INPUTS_REQUIRED");
      const current = store.candidateArtifacts(credential);
      const observers = store.db
        .prepare("SELECT json FROM task_writer_delegations WHERE task_id=? ORDER BY rowid DESC")
        .all(credential.taskNodeId) as Array<{ json: string }>;
      const observed = observers
        .map((row) => JSON.parse(row.json) as TaskWriterDelegation)
        .find(
          (d) =>
            d.mode === "observer" &&
            d.parent.epoch === credential.epoch &&
            d.contractRevision === view.contract.revision &&
            d.phase === "returned",
        );
      if (!observed || !observed.candidateArtifacts?.length)
        throw new Error("TASK_VERIFIER_RUN_MISSING");
      const actualRun = getSubagentRunByRunId(observed.childRunId);
      if (
        !actualRun ||
        actualRun.childSessionKey !== observed.child.sessionKey ||
        actualRun.requesterSessionKey !== credential.sessionKey ||
        typeof actualRun.endedAt !== "number" ||
        actualRun.outcome?.status !== "ok" ||
        actualRun.orchestration?.isVerifier !== true
      )
        throw new Error("TASK_VERIFIER_RUN_INVALID");
      const verdict = resolveStructuredVerificationVerdict({
        orchestrationVerdict: actualRun.orchestration.verificationVerdict,
        outcomeStatus: actualRun.outcome.status,
        resultText: actualRun.completion?.resultText ?? undefined,
      });
      if (verdict.verdict !== "pass") throw new Error("TASK_VERIFIER_NOT_APPROVED");
      if (JSON.stringify(observed.candidateArtifacts) !== JSON.stringify(current))
        throw new Error("TASK_VERIFIER_CANDIDATE_CHANGED");
      artifacts = current;
      verifierRunId = actualRun.runId;
    } else throw new Error("TASK_OWNER_VERIFIER_UNAVAILABLE");
    artifacts = [...new Map(artifacts.map((a) => [a.path, a])).values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const refs: EvidenceRef[] = [
      ...artifacts.map((a) => ({ type: "file" as const, ref: `${a.path}#sha256=${a.sha256}` })),
      ...evidence.map((e) => ({ type: "tool" as const, ref: e.receiptId })),
      ...(verifierRunId ? [{ type: "subagent" as const, ref: verifierRunId }] : []),
    ];
    const verifier = resolveVerifierCompletionVerdict({
      input: {
        taskId: credential.taskNodeId,
        objective: view.contract.objective,
        obligations: [
          {
            id: criterion.id,
            description: criterion.description,
            status: "satisfied",
            evidenceRefs: refs,
          },
        ],
        evidenceRefs: refs,
        toolResults: [],
        eventReplay: {
          status: view.pendingOperations ? "inconsistent" : "consistent",
          diagnosticCodes: [],
          pendingToolCallIds: [],
        },
      },
      policy: { requiredEvidenceKinds: ["file"] },
      scope: { taskIds: [credential.taskNodeId] },
      priorStatus: view.contract.state,
    });
    if (verifier.verdict !== "approved") throw new Error(`TASK_VERIFIER_${verifier.verdict}`);
    const binding = {
      taskNodeId: credential.taskNodeId,
      revision: view.contract.revision,
      epoch: credential.epoch,
      generation: credential.generation,
      candidate,
      criterionId: criterion.id,
      evidenceDigest: verifier.evidenceDigest,
      verifierRunId,
    };
    const verifierReceiptId = `task-verifier:${createHash("sha256").update(JSON.stringify(binding)).digest("hex")}`;
    const effects = new EffectReceiptStore();
    const effect = effects.record({
      idempotencyKey: verifierReceiptId,
      proposal: binding,
      domainExecutor: "task-verification-journal",
      outcome: "applied",
      journalRef: `task-ledger:${credential.taskNodeId}:evidence:${verifier.evidenceDigest}`,
      recoverability: "read-and-revalidate-candidate",
      stage1Context: {
        actor: {
          sessionKey: credential.sessionKey,
          runId: verifierRunId ?? credential.taskNodeId,
          attemptIndex: credential.epoch,
          modelCallIndex: 0,
          actorKind: "principal",
        },
        effect: {
          toolCallId: verifierReceiptId,
          toolName: "task_control",
          resource: credential.taskNodeId,
          action: "record-verification",
        },
      },
    });
    if (!effect.ok) throw new Error("TASK_EFFECT_RECEIPT_CONFLICT");
    const effectRead = effects.getById(effect.effectReceiptId);
    if (
      !effectRead ||
      effectRead.proposal_digest !== effectProposalDigest(binding) ||
      effectRead.outcome !== "applied"
    )
      throw new Error("TASK_EFFECT_RECEIPT_UNAVAILABLE");
    const admitted = admitTaskCompletionClaim({
      taskId: credential.taskNodeId,
      activeCandidateDigest: candidate,
      activeGeneration: credential.generation,
      verifier: { ...verifier, candidateDigest: candidate, generation: credential.generation },
      effect: {
        taskId: credential.taskNodeId,
        candidateDigest: candidate,
        generation: credential.generation,
        status: "applied",
        evidenceDigest: verifier.evidenceDigest,
        source: "effect-owner",
      },
    });
    if (!admitted.accepted) throw new Error(`TASK_COMPLETION_${admitted.reason}`);
    store.recordOwnerEvidence(credential, criterion.id, candidate, {
      owner: verification.owner,
      verifierReceiptId,
      effectReceiptId: effect.effectReceiptId,
      evidenceDigest: verifier.evidenceDigest,
      proposalDigest: effectRead.proposal_digest,
      artifacts,
    });
  }
  return store.accept(credential, candidate);
}

export function readPersistentTaskCompletionReceipt(
  store: TaskSystemStore,
  refs: {
    taskId: string;
    candidateDigest: string;
    generation: string;
    verifierReceiptId: string;
    effectReceiptId: string;
  },
) {
  const view = store.get(refs.taskId);
  const c = view.claim;
  const evidence = store
    .getTaskEvidence(refs.taskId)
    .find(
      (e) =>
        e.receiptId === refs.verifierReceiptId &&
        e.ownerProof?.effectReceiptId === refs.effectReceiptId,
    );
  if (
    !c ||
    c.generation !== refs.generation ||
    !evidence?.ownerProof ||
    evidence.revision !== view.contract.revision ||
    evidence.candidate !== refs.candidateDigest
  )
    throw new Error("TASK_COMPLETION_RECEIPT_SCOPE_MISMATCH");
  const effect = new EffectReceiptStore().getById(refs.effectReceiptId);
  if (
    !effect ||
    effect.outcome !== "applied" ||
    effect.proposal_digest !== evidence.ownerProof.proposalDigest ||
    effect.domain_executor !== "task-verification-journal"
  )
    throw new Error("TASK_EFFECT_RECEIPT_UNAVAILABLE");
  const credential = {
    taskNodeId: c.taskNodeId,
    sessionKey: c.sessionKey,
    generation: c.generation,
    epoch: evidence.epoch,
  };
  if (view.contract.state === "done")
    store.replayCompletedTask(c.taskNodeId, c.sessionKey, c.generation, refs.candidateDigest);
  else store.validatedEvidence(credential, refs.candidateDigest, [evidence.criterionId]);
  return {
    taskId: refs.taskId,
    credential,
    claim: {
      schema: "TaskCompletionClaim/v1" as const,
      taskId: refs.taskId,
      candidateDigest: refs.candidateDigest,
      generation: refs.generation,
      verifierReceiptId: refs.verifierReceiptId,
      effectReceiptId: refs.effectReceiptId,
      verifierDigest: evidence.ownerProof.evidenceDigest,
      effectDigest: evidence.ownerProof.evidenceDigest,
      priorStatus: view.contract.state,
    },
    priorStatus: view.contract.state,
  };
}

/** The model supplies only a receipt ID; effect identity and outcome come from the existing owner. */
export function reconcilePersistentTaskEffect(
  store: TaskSystemStore,
  credential: TaskCredential,
  operationId: string,
  effectReceiptId: string,
): TaskView {
  const operation = store.operation(credential, operationId);
  const receipt = new EffectReceiptStore().getById(effectReceiptId);
  if (!receipt) throw new Error("TASK_EFFECT_RECEIPT_UNAVAILABLE");
  let context: {
    actor?: { sessionKey?: string; runId?: string };
    effect?: { toolCallId?: string; toolName?: string };
  };
  try {
    context = JSON.parse(receipt.effect_context_json);
  } catch {
    throw new Error("TASK_EFFECT_RECEIPT_IDENTITY_INVALID");
  }
  const actor = context.actor,
    effect = context.effect;
  if (
    !actor?.runId ||
    !effect?.toolCallId ||
    actor.sessionKey !== credential.sessionKey ||
    effect.toolName !== operation.kind ||
    `${actor.runId}:${effect.toolCallId}` !== operationId ||
    Number(receipt.created_at) < operation.startedAt
  )
    throw new Error("TASK_EFFECT_RECEIPT_SCOPE_MISMATCH");
  if (receipt.outcome !== "applied" && receipt.outcome !== "not_applied")
    throw new Error("TASK_EFFECT_OUTCOME_UNKNOWN");
  return store.reconcileOperation(credential, operationId, {
    id: effectReceiptId,
    outcome: receipt.outcome,
    owner: receipt.domain_executor,
  });
}
