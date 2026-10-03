/**
 * Root for the visual and evidence artifacts that a handful of E2E specs
 * generate as reviewable output.
 *
 * Those specs default to their historical tracked repository paths, so the
 * normal `pnpm run test:e2e` loop keeps publishing the PNGs and evidence JSON
 * next to the code. The RC-09 acceptance reruns the same suite inside a detached
 * candidate worktree and requires that worktree to stay byte-clean afterwards,
 * so it points `CLAWX_E2E_EVIDENCE_ROOT` at a directory outside the candidate.
 *
 * When the variable is unset the returned path is byte-identical to the literal
 * the spec used before, so nothing about the specs' behaviour changes.
 */
export function evidencePath(relativePath: string): string {
  const root = process.env.CLAWX_E2E_EVIDENCE_ROOT?.trim();
  if (!root) return relativePath;
  return `${root.replace(/[\\/]+$/u, '')}/${relativePath}`;
}
