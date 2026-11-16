export function verifyVerseGitEvaluation(report: unknown, expectedManifest: {
  binarySha256: string; capabilitiesSha256: string; sourceCommit: string;
}): { ok: boolean; issues: string[] };
