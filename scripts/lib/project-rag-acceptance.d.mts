export const RAG_SOAK_MINIMUM_MS: number;
export const RAG_CAPACITY_MODELS: Readonly<Record<number, string>>;
export function validateRagCapacity(report: unknown, mode: 'portable' | 'ann', dimensions: 768 | 4096): string[];
export function readBoundEvidence(root: string, input: { path: string; sha256: string }): unknown;
export function validateRagSoak(report: unknown): string[];
export function validateRagSoakProbe(probe: unknown): string[];
export function readProjectRagAcceptance(directory: string, manifest: unknown): { schema: 'ProjectRagAcceptance/v1'; candidate: string; status: 'passed' | 'NO_GO'; reasons: string[]; driven_by: 'agent'; actor: string; qualificationScope: 'all-platforms' | 'windows-only'; requiredPlatforms: string[]; deferredPlatforms: Array<{ target: string; status: 'deferred' }>; realHumanEvidence: false; productPublished: false };
