export function collectEvidenceRefs(root?: string): Map<string, string[]>;
export function checkEvidenceRefs(root?: string): { ok: boolean; missing: Array<{ owner: string; ref: string }> };

export type ProductSemanticEvidenceDiagnostic = { relationKey: string; field: string; rule: string; message: string };
export type ProductSemanticEvidenceReport = {
  schema: string;
  contractVersion: string | null;
  driven_by: string;
  actor: string;
  command: string;
  checkedAt: string;
  candidate: { commit: string; tree: string; dirty: boolean } | null;
  hashPolicy: { algorithm: string; canonical: string; normalization: string; raw: string };
  relationKeys: string[];
  relationSources: Array<{ relationKey: string; evidenceGrade: string; documentation: Array<{ path: string; locator: string }>; owners: Array<{ path: string; locator: string }> }>;
  sourceRefs: Array<{ path: string; canonicalSha256: string; rawSha256: string; candidateBlobRawSha256: string; tracked: boolean }>;
  checks: Array<{ id: string; command: string; exitCode: number }>;
  diagnostics: ProductSemanticEvidenceDiagnostic[];
  unverified: string[];
  status: 'valid' | 'invalid';
};
export function createProductSemanticEvidence(root?: string, options?: { actor?: string; command?: string }): ProductSemanticEvidenceReport;
export function validateProductSemanticEvidence(root: string, report: unknown): { valid: boolean; diagnostics: ProductSemanticEvidenceDiagnostic[] };
