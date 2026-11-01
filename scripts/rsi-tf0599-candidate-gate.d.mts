export type RsiGateError = { code: string; message: string; path: string | null };
export type RsiGateValidation = { passed: boolean; errors: RsiGateError[] };
export type RsiGateInputs = {
  corpus: {
    taskId: string;
    protocol: { k: number; minimumCompleteCases: number };
    provenance: { realHuman: boolean; realProvider: boolean };
    cases: Array<{ id: string; taskId: string; category: string; packet: string }>;
  };
  raw: { performanceEvidence: boolean; cases: Array<{ caseId: string; taskId: string; trials: Array<{ outcome: string; failureClass: string | null; repeat?: number } | string> }> };
  policy: { taskSet: { minimumCompleteCases: number; k: number } };
};
export type RsiCandidateEnvelope = {
  schemaVersion: string; candidateId: string; authoredBy: string; candidateDigest: string;
  suiteId: string; suiteContentDigest: string | null; heldOutSplitDigest: string | null;
  k: number; minimumCompleteCases: number;
  model: { status: string; id: string | null; version: string | null };
  tools: { status: string; manifestDigest: string | null };
  seed: { status: string; value: number | null };
  networkMode: string;
  resources: { cpuFloorCores: number; cpuCeilingCores: number; memoryFloorBytes: number; memoryCeilingBytes: number; concurrency: number; retries: number };
  executorActor: string; verifierActor: string;
};
export type RsiGateControlResult = { id: string; expectedCode: string; observedCodes: string[]; passed: boolean };
export type RsiCandidateGateReport = {
  schemaVersion: string; taskId: string; generatedAt: string; driven_by: string; actor: string;
  status: string; gate: string; reasons: string[];
  suite: { sourceDir: string; caseCount: number; publicCaseCount: number; heldOutCaseCount: number; heldOutDigest: string | null; corpusDigest: string };
  envelope: RsiCandidateEnvelope; validation: RsiGateValidation;
  aggregate: { gate: string; completeCaseCount: number; caseCount: number; passK: number | null; passAtK: number | null; incomplete: Array<{ caseId: string; trialIndex: number; outcome: string }>; missingCases: string[] };
  failureClasses: Record<'infrastructure' | 'task' | 'grader' | 'agent', number>;
  claims: { realHuman: boolean; liveProvider: boolean; promotionReady: boolean; productLocksChanged: boolean };
  limitations: string[];
};
export const TF0599_PACK_DIR: string;
export const TF0599_SCHEMA: string;
export const TF0599_ACTOR: string;
export function baseEnvelope(corpus: RsiGateInputs['corpus']): RsiCandidateEnvelope;
export function loadInputs(root?: string): RsiGateInputs;
export function validateCandidateGate(inputs: RsiGateInputs, envelope: RsiCandidateEnvelope, root?: string): RsiGateValidation;
export function summarizeCandidateTrials(corpus: RsiGateInputs['corpus'], raw: RsiGateInputs['raw'], envelope: RsiCandidateEnvelope): RsiCandidateGateReport['aggregate'];
export function buildCandidateGateReport(inputs: RsiGateInputs, envelope: RsiCandidateEnvelope, root?: string): RsiCandidateGateReport;
export function runNegativeControls(inputs: RsiGateInputs, envelope: RsiCandidateEnvelope, root?: string): RsiGateControlResult[];
export function writeCandidateGatePack(root?: string): { report: RsiCandidateGateReport; controls: RsiGateControlResult[] };export function systemRunCases(systemRun: any): any;
export function summarizeMeasuredSystemRun(corpus: any, systemRun: any, envelope: any): any;
export function buildMeasuredSystemRunReport(inputs: any, envelope: any, systemRun: any, root?: string): any;
export function writeMeasuredSystemRunPack(root?: string, outDir?: string): any;
