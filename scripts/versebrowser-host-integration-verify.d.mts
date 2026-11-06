import type { EvidenceCheck } from './versebrowser-evidence-verify.mjs';
export function verifyHostIntegration(input?: {
  hostRoot?: string;
  sourceRoot?: string;
  sourceCommit?: string;
}): Promise<EvidenceCheck & {
  schemaVersion: number;
  driven_by: string;
  actor: string;
  source: { root: string; commit: string | null };
  patches: EvidenceCheck;
  patchApply: EvidenceCheck;
  wiring: EvidenceCheck;
}>;
