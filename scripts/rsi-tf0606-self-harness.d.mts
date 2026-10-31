export type RsiSelfHarnessError = { code: string; message: string; path: string | null };
export type RsiSelfHarnessValidation = { passed: boolean; errors: RsiSelfHarnessError[] };
export type RsiWeakness = {
  id: string; taskId: string; caseId: string; taskType: string;
  sourceRefs: string[]; evidenceLinks: string[]; failureSignal: string;
  metadata: Record<string, unknown>;
};
export type RsiSelfHarnessCandidate = {
  schemaVersion: string; candidateId: string; authoredBy: string;
  surface: "prompt" | "agents" | "skill" | "tool-policy" | "sekb-playbook";
  isolation: string; sourceCaseIds: string[]; targetTaskTypes: string[];
  weaknessIds: string[]; contentType: string; autoMerge: boolean; promotionReady: boolean;
  change: { title: string; prompt: string; sourceTrajectoryIds: string[]; rollback: string; budget: { maxTokens: number; maxTurns: number; maxToolCalls: number } };
  digest: string;
};
export type RsiSelfHarnessReport = {
  schemaVersion: string; generatedAt: string; driven_by: string; actor: string;
  status: string; promotionReady: boolean; autoMerge: boolean; weakenedTaskCount: number;
  candidate: RsiSelfHarnessCandidate;
  evaluation: { delegatedGate: string; suite: string; caseCount: number; completeCaseCount: number; k: number; passK: number | null; passAtK: number | null; costCeilingRelativeIncrease: number; heldOutSplitDigest: string | null; failureClassCounts: Record<string, number> };
  reasons: string[];
  claims: { realHuman: boolean; liveProvider: boolean; promotionReady: boolean; autoMerge: boolean; productLocksChanged: boolean };
  sourceDigests: { corpus: string; gate: string };
};
export type RsiSelfHarnessControlResult = { id: string; expectedCode: string; observedCodes: string[]; passed: boolean };
export const TF0606_PACK_DIR: string;
export const TF0606_SCHEMA: string;
export const TF0606_ACTOR: string;
export function baseEnvelope(corpus: unknown): Record<string, unknown>;
export function loadInputs(root?: string): { corpus: { taskId: string; protocol: { k: number; minimumCompleteCases: number }; provenance: { realHuman: boolean; realProvider: boolean }; cases: Array<{ id: string; taskId: string; category: string; packet: string; title: string; sourceRefs: string[] }> }; raw: unknown; policy: unknown };
export function mineWeaknesses(corpus: { cases: Array<{ id: string; taskId: string; category: string; sourceRefs: string[]; title: string }> }): RsiWeakness[];
export function buildCandidate(corpus: { cases: Array<{ category: string }> }, weaknesses: RsiWeakness[]): RsiSelfHarnessCandidate;
export function validateSelfHarness(context: { corpus: { cases: Array<{ id: string }> }; weaknesses: RsiWeakness[]; candidate: RsiSelfHarnessCandidate; report: RsiSelfHarnessReport; gateReport: { status: string; gate: string } }): RsiSelfHarnessValidation;
export function buildSelfHarnessReport(corpus: { taskId: string; cases: unknown[] }, weaknesses: RsiWeakness[], candidate: RsiSelfHarnessCandidate, gateReport: { aggregate: { completeCaseCount: number; passK: number | null; passAtK: number | null }; envelope: { k: number; heldOutSplitDigest: string | null }; failureClasses: Record<string, number> }, root?: string): RsiSelfHarnessReport;
export function runSelfHarnessNegativeControls(context: unknown): RsiSelfHarnessControlResult[];
export function writeSelfHarnessPack(root?: string): { report: RsiSelfHarnessReport; candidate: RsiSelfHarnessCandidate; weaknesses: RsiWeakness[]; controls: RsiSelfHarnessControlResult[]; validation: RsiSelfHarnessValidation };