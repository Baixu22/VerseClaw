/**
 * C5-2: patch-flow — workers produce apply_patch text (no disk), lead serial applies + verifies.
 */
import type { FactStore } from "../context-engine/factstore/store.js";
import { reviewDiff } from "../context-engine/views/verify/review-diff-view.js";
import { applyPatch } from "./apply-patch.js";

export type PatchProposal = {
  workerId: string;
  patchText: string;
  writeSet?: string[];
};

export type PatchFlowApplyResult = {
  workerId: string;
  ok: boolean;
  error?: string;
  summary?: { added: string[]; modified: string[]; deleted: string[] };
  verify?: { relatedTests: string[]; riskLevel: string };
};

export async function applyPatchProposalsSerial(params: {
  cwd: string;
  proposals: PatchProposal[];
  factStore?: FactStore;
}): Promise<PatchFlowApplyResult[]> {
  const results: PatchFlowApplyResult[] = [];
  for (const proposal of params.proposals) {
    try {
      const applied = await applyPatch(proposal.patchText, {
        cwd: params.cwd,
        workspaceOnly: true,
      });
      let verify: PatchFlowApplyResult["verify"];
      if (params.factStore) {
        const changed = [
          ...applied.summary.added,
          ...applied.summary.modified,
          ...applied.summary.deleted,
        ];
        const review = reviewDiff(params.factStore, params.cwd, { changedFiles: changed });
        verify = { relatedTests: review.relatedTests ?? [], riskLevel: review.riskLevel };
      }
      results.push({
        workerId: proposal.workerId,
        ok: true,
        summary: applied.summary,
        verify,
      });
    } catch (error) {
      results.push({
        workerId: proposal.workerId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
