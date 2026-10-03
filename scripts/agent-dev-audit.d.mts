/* Auto-generated test typing surface for agent-dev-audit.mjs */
export const DIMENSIONS: any;
export const REQUIRED_FAST_PATHS: any;
export const REQUIRED_FULL_GATES: any;
export const buildAuditReport: any;
export const collectEvidenceInventory: any;
export function collectGitSourceState(root: string, relativePaths: readonly string[]): {
  dirty: Set<string>;
  times: Map<string, number>;
} | null;
export function resolveSourceChangeTimeMs(
  source: { path: string; mtimeMs: number },
  gitState: ReturnType<typeof collectGitSourceState>,
): { timeMs: number; timeSource: 'git-commit' | 'worktree-mtime' };
export const evaluateCoverageBreadth: any;
export const evaluateDocsRunbook: any;
export const evaluateEvidenceCompleteness: any;
export const evaluateGateIntegrity: any;
export const evaluateMaintainability: any;
export const evaluatePerformanceDiscipline: any;
export const gradeForScore: any;
export const maturityLevelForScore: any;
export const parseAuditArgs: any;
