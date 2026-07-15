/**
 * C5-2: patch-flow - workers produce apply_patch text (no disk), lead serial applies + verifies.
 * Hard-destructive Delete/Move/large-blast reuses C2-10 classifyWriteDestructiveTier surface.
 * Opt-in orchestration only: runtime.coding.patchFlow.default remains false.
 */
import type { FactStore } from "../context-engine/factstore/store.js";
import { reviewDiff } from "../context-engine/views/verify/review-diff-view.js";
import { applyPatch } from "./apply-patch.js";
import {
  classifyWriteDestructiveTier,
  type DestructiveClassification,
} from "./write-destructive-tier.js";

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
  destructive?: DestructiveClassification;
};

/** Classify a worker proposal for the existing destructive approval surface (C2-10). */
export function classifyPatchProposalDestructive(patchText: string): DestructiveClassification {
  return classifyWriteDestructiveTier({
    toolName: "apply_patch",
    args: { input: patchText },
  });
}

/** Hard-destructive ops that share the C2-10 approval surface (not routine Update). */
export function isHardDestructivePatch(classification: DestructiveClassification): boolean {
  if (!classification.requiresApproval) {
    return false;
  }
  return (
    classification.reason === "apply_patch_delete_or_move" ||
    classification.reason === "apply_patch_large_blast" ||
    classification.reason === "large_overwrite"
  );
}

export async function applyPatchProposalsSerial(params: {
  cwd: string;
  proposals: PatchProposal[];
  factStore?: FactStore;
  /**
   * When true, allow hard-destructive proposals without host approval.
   * Default false: Delete/Move/large-blast hold on approval path (C2-10).
   * Routine Update File proposals still apply serially without this flag.
   */
  applyDestructiveWithoutApproval?: boolean;
}): Promise<PatchFlowApplyResult[]> {
  const results: PatchFlowApplyResult[] = [];
  for (const proposal of params.proposals) {
    const destructive = classifyPatchProposalDestructive(proposal.patchText);
    if (isHardDestructivePatch(destructive) && params.applyDestructiveWithoutApproval !== true) {
      results.push({
        workerId: proposal.workerId,
        ok: false,
        error: `destructive_requires_approval:${destructive.reason}`,
        destructive,
      });
      continue;
    }
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
        destructive,
      });
    } catch (error) {
      results.push({
        workerId: proposal.workerId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        destructive,
      });
    }
  }
  return results;
}