/**
 * P2b execution-side patch flow.
 *
 * Proposal-only orchestration workers return fenced apply_patch text. The
 * candidate-first path materializes and verifies one combined candidate before
 * the existing journaled apply path may touch the base workspace. Legacy direct
 * apply remains available only when no candidate-apply host is supplied.
 */
import type { ApplyPatchJournalOptions } from "./apply-patch-types.js";
import {
  applyCandidateAfterVerification,
  materializePatchCandidate,
  type CandidateApplyDecision,
  type CandidateApplyHost,
  type CandidateApplyPermit,
  type CandidateApplyTraceEvent,
  type CandidateApplyVerification,
  type PatchCandidateManifest,
} from "./orchestration-candidate-apply.js";
import { applyPatchProposalsSerial, type PatchProposal } from "./patch-flow.js";
import type {
  SubagentRunRecord,
  TeamPatchFlowResultSummary,
  TeamPatchFlowStatus,
} from "./subagent-registry.types.js";

export const PATCH_FLOW_PROPOSAL_ONLY_DENIED_TOOLS = [
  "write",
  "edit",
  "apply_patch",
  "bash",
  "exec",
] as const;

const PATCH_FLOW_FENCE_PATTERN = /```apply_patch[^\S\r\n]*\r?\n([\s\S]*?)```/u;

export type DeferredPatchFlowOutcome = {
  status: TeamPatchFlowStatus;
  proposalCount: number;
  results: TeamPatchFlowResultSummary[];
  appliedAt: number;
  error?: string;
  candidate?: PatchCandidateManifest;
  verification?: CandidateApplyVerification;
  permit?: CandidateApplyPermit;
  decision?: CandidateApplyDecision;
  trace?: CandidateApplyTraceEvent[];
  cleanup?: { ok: boolean; issues: string[] };
};

function frozenWorkerResult(worker: SubagentRunRecord): string | undefined {
  return (
    worker.completion?.resultText ??
    worker.delivery?.payload?.frozenResultText ??
    worker.completion?.fallbackResultText ??
    worker.delivery?.payload?.fallbackFrozenResultText ??
    undefined
  )?.trim() || undefined;
}

export function extractPatchProposalsFromWorkers(
  workers: readonly SubagentRunRecord[],
): PatchProposal[] {
  const proposals: PatchProposal[] = [];
  for (const worker of workers) {
    const text = frozenWorkerResult(worker);
    if (!text) continue;
    const match = text.match(PATCH_FLOW_FENCE_PATTERN);
    const patchText = match?.[1]?.trim();
    if (!patchText) continue;
    proposals.push({
      workerId: worker.runId,
      patchText,
      ...(worker.orchestration?.patchFlowWriteSet?.length
        ? { writeSet: [...worker.orchestration.patchFlowWriteSet] }
        : {}),
    });
  }
  return proposals;
}

function summarizeResult(result: Awaited<ReturnType<typeof applyPatchProposalsSerial>>[number]): TeamPatchFlowResultSummary {
  return {
    workerId: result.workerId,
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.destructive
      ? {
          destructive: {
            ...(result.destructive.reason ? { reason: result.destructive.reason } : {}),
            ...(typeof result.destructive.requiresApproval === "boolean"
              ? { requiresApproval: result.destructive.requiresApproval }
              : {}),
          },
        }
      : {}),
    ...(result.journal
      ? {
          journal: {
            batchId: result.journal.batchId,
            batchState: result.journal.batchState,
            undoable: result.journal.undoable,
            snapshotIds: result.journal.snapshots.map((snapshot) => snapshot.journalEntryId),
          },
        }
      : {}),
    ...(result.recoveryRef ? { recoveryRef: result.recoveryRef } : {}),
  };
}

export async function applyDeferredPatchFlow(params: {
  workers: readonly SubagentRunRecord[];
  workspaceDir: string | undefined;
  now?: () => number;
  candidateApply?: {
    host: CandidateApplyHost;
    journal: ApplyPatchJournalOptions;
    applyProposals?: typeof applyPatchProposalsSerial;
  };
}): Promise<DeferredPatchFlowOutcome> {
  const now = params.now ?? Date.now;
  const appliedAt = now();
  const proposals = extractPatchProposalsFromWorkers(params.workers);
  if (proposals.length === 0) {
    return { status: "no-proposals", proposalCount: 0, results: [], appliedAt };
  }
  if (!params.workspaceDir) {
    return {
      status: "failed",
      proposalCount: proposals.length,
      results: [],
      appliedAt,
      error: "patch_flow_workspace_missing",
    };
  }
  if (params.candidateApply) {
    const materialized = await materializePatchCandidate({
      workspaceDir: params.workspaceDir,
      proposals,
    });
    if (materialized.status !== "frozen") {
      return {
        status: "failed",
        proposalCount: proposals.length,
        results: materialized.proposalResults.map(summarizeResult),
        appliedAt: now(),
        error: `candidate_materialize_failed:${materialized.reason}:${materialized.issues.join(",")}`,
      };
    }
    const outcome = await applyCandidateAfterVerification({
      workspaceDir: params.workspaceDir,
      candidate: materialized.manifest,
      candidateRoot: materialized.candidateRoot,
      proposals,
      host: params.candidateApply.host,
      journal: params.candidateApply.journal,
      now,
      ...(params.candidateApply.applyProposals
        ? { applyProposals: params.candidateApply.applyProposals }
        : {}),
    });
    const status: TeamPatchFlowStatus =
      outcome.status === "applied" ? "applied"
        : outcome.status === "partial" ? "partial"
          : outcome.status === "verification-failed" ? "verification-failed"
            : outcome.status === "preflight-rejected" ? "blocked"
              : outcome.status === "unknown" ? "unknown"
                : "failed";
    return {
      status,
      proposalCount: proposals.length,
      results: outcome.proposalResults.map(summarizeResult),
      appliedAt: now(),
      ...(outcome.reason ? { error: outcome.reason } : {}),
      candidate: materialized.manifest,
      ...(outcome.verification ? { verification: outcome.verification } : {}),
      ...(outcome.permit ? { permit: outcome.permit } : {}),
      decision: outcome.decision,
      trace: outcome.trace,
      cleanup: outcome.cleanup,
    };
  }
  try {
    const applied = await applyPatchProposalsSerial({
      cwd: params.workspaceDir,
      proposals,
    });
    const results = applied.map(summarizeResult);
    const okCount = results.filter((result) => result.ok).length;
    const status: TeamPatchFlowStatus =
      okCount === results.length ? "applied" : okCount > 0 ? "partial" : "failed";
    return { status, proposalCount: proposals.length, results, appliedAt };
  } catch (error) {
    return {
      status: "failed",
      proposalCount: proposals.length,
      results: [],
      appliedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
