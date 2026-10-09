export type LocomoEvidenceOptions = { root?: string; now?: number; maxAgeMs?: number };
export type LocomoQuestion = { questionId: string; conversationId: string; category: string; question: string; groundTruth: string; goldEvidence: string[] };
export type LocomoProvenance = {
  driven_by: string; actor: string; runId: string; startedAt: string; sourceRevision: string; sourceMethod: string;
  evaluationEnvironment: Record<string, string | boolean>;
  sources: Record<string, string>; dataset: { path: string; sha256: string }; provider: { endpoint: string; model: string };
};
export function sha256(bytes: string | Uint8Array): string;
export function collectLocomoSources(root?: string): Record<string, string>;
export function expectedLocomoQuestions(root?: string): LocomoQuestion[];
export function createLocomoProvenance(provider: { endpoint: string; model: string }, root?: string): LocomoProvenance;
export function writeLocomoReport(report: unknown, file: string): void;
export function assertLocomoReportConsistency(report: unknown, options?: LocomoEvidenceOptions): { consistent: boolean; runId: string; totalQuestions: number; model: string; sourceFileCount: number; modelCalls: number };
export function assertVerifiedLocomoReport(report: unknown, options?: LocomoEvidenceOptions): { verified: boolean; runId: string; totalQuestions: number; model: string; sourceFileCount: number; modelCalls: number };
export function verifyLocomoEvidenceFile(file: string, options?: LocomoEvidenceOptions): ReturnType<typeof assertVerifiedLocomoReport> & { report: string; sha256: string };
