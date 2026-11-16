export type EvidenceIssue = { kind: string; [key: string]: unknown };
export type EvidenceCheck = { status: 'pass' | 'fail'; issues: EvidenceIssue[] };
export function verifyCurrent(hostRoot: string): Promise<EvidenceCheck>;
export function verifyEvidence(hostRoot?: string): Promise<EvidenceCheck & {
  schemaVersion: number;
  driven_by: string;
  actor: string;
  scope: string;
  sections: Record<string, EvidenceCheck>;
}>;
