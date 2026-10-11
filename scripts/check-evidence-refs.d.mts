export function collectEvidenceRefs(root?: string): Map<string, string[]>;
export function checkEvidenceRefs(root?: string): { ok: boolean; missing: Array<{ owner: string; ref: string }> };
