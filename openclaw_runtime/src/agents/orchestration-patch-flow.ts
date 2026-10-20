/**
 * P2b execution-side patch flow.
 *
 * Proposal-only orchestration workers return fenced apply_patch text. After all
 * expected workers complete, this module extracts those proposals and applies
 * them serially through the existing C5-2 API. It is deliberately best-effort:
 * the caller records failures and continues the ordinary verifier flow.
 */
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
  };
}

export async function applyDeferredPatchFlow(params: {
  workers: readonly SubagentRunRecord[];
  workspaceDir: string | undefined;
  now?: () => number;
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
