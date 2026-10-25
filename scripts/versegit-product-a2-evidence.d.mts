export function sha256(value: string | Uint8Array): string;
export function documentDigest(document: Record<string, any>): string;
export function validateBuildIdentity(document: Record<string, any>, options?: Record<string, any>): { ok: boolean; issues: string[] };
export function validateSmokeResults(document: Record<string, any>): { ok: boolean; issues: string[] };
export function validateElectronStartup(document: Record<string, any>): { ok: boolean; issues: string[] };
export function validateCleanup(document: Record<string, any>): { ok: boolean; issues: string[] };
export function checkEvidence(root?: string): Record<string, any>;
