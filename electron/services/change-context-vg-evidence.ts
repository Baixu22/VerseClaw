import type { ChangeContextEvidenceProjection, ChangeContextProjection } from '@shared/types/change-context';
import { readCurrentVerseGitReviewFacts } from '../gateway/versegit-bridge';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { readCompletedVerseGitReviewFacts } from './versegit-receipt-evidence';

export function createChangeContextVgEvidenceReader(options: {
  enabled?: () => boolean;
  workspace?: typeof getActiveWorkspaceProfile;
  observations?: typeof readCurrentVerseGitReviewFacts;
  receipt?: typeof readCompletedVerseGitReviewFacts;
} = {}) {
  return async (projection: ChangeContextProjection): Promise<ChangeContextEvidenceProjection[]> => {
    if (!(options.enabled ?? (() => process.env.CLAWX_VERSGIT_BINDING_ENABLED === '1'))()) return [];
    const base = { source: 'versegit' as const, advisory: true as const, hostVerdict: 'unchanged' as const };
    const missing: ChangeContextEvidenceProjection[] = [
      { ...base, kind: 'candidate', state: 'unavailable', summary: 'candidate-unmeasured', refs: [], execution: 'unmeasured' },
      { ...base, kind: 'receipt', state: 'partial', summary: 'receipt-unmeasured', refs: [], execution: 'unmeasured' },
    ];
    try {
      const workspace = await (options.workspace ?? getActiveWorkspaceProfile)();
      if (!workspace || workspace.id !== projection.identity.workspaceId) return missing;
      const observed = (options.observations ?? readCurrentVerseGitReviewFacts)({ workspaceRoot: workspace.rootPath,
        sessionKey: projection.identity.sessionKey, runId: projection.identity.runId });
      const receipt = projection.identity.runId ? (options.receipt ?? readCompletedVerseGitReviewFacts)(projection.identity.runId, workspace.rootPath) : null;
      const admitted = receipt?.verdict.hostVerdict === 'unchanged' && receipt.verdict.singleGreenLight === false
        && projection.comparison?.candidate?.kind === 'git-commit'
        && projection.comparison.candidate.commit === receipt.candidateCommitOid
        && receipt.receiptId === receipt.verdict.receiptId && receipt.verdict.planId === projection.identity.runId
        && receipt.verdict.realVerseshellExecution && receipt.verdict.evidenceGrade === 'direct-receipt'
        && receipt.verdict.status === 'observed';
      const evidence: ChangeContextEvidenceProjection[] = observed ? [{ ...base, kind: 'stale-read',
        state: observed.staleReads.length ? 'stale' : 'partial', summary: observed.staleReads.length ? 'stale-read-observed' : 'coverage-partial',
        refs: [observed.bindingId, ...observed.staleReads.map((finding) => finding.findingId)],
        paths: [...new Set(observed.staleReads.map((finding) => finding.path))].slice(0, 20), execution: 'unmeasured' }] : [];
      evidence.push({ ...base, kind: 'candidate', state: receipt ? 'partial' : 'unavailable', summary: receipt ? 'candidate-observed' : 'candidate-unmeasured',
        candidateId: receipt?.candidateId ?? null, execution: 'unmeasured', refs: receipt?.refs ?? [] });
      evidence.push({ ...base, kind: 'receipt', state: admitted ? 'available' : 'partial',
        summary: admitted ? 'receipt-bound' : 'receipt-unmeasured', receiptId: receipt?.receiptId ?? null, candidateId: receipt?.candidateId ?? null,
        execution: admitted ? receipt.verdict.dimensions.execution === 'verified' ? 'verified' : 'failed' : 'unmeasured', refs: receipt?.refs ?? [] });
      return evidence;
    } catch { return missing; }
  };
}
