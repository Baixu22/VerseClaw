export function sha256(value: string | Uint8Array): string;
export function documentDigest(document: Record<string, any>): string;
export function candidateIdentity(inputs: Array<Record<string, any>>, binary: Record<string, any>): string;
export function findAbsolutePathLeaks(value: unknown): string[];
export function normalizeEvidenceIssues(root: string, issues: string[]): string[];
export function validateInputManifest(manifest: Record<string, any>, options?: Record<string, any>): { ok: boolean; issues: string[] };
export function validateHistoricalIndex(index: Record<string, any>, options?: Record<string, any>): { ok: boolean; issues: string[] };
export function validateNegativeChecks(document: Record<string, any>): { ok: boolean; issues: string[] };
export function checkEvidence(root?: string): Record<string, any>;
