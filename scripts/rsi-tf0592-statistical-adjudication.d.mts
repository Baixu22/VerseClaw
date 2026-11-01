export type Tf0592Error = { code: string; message: string };
export type Tf0592Validation = { passed: boolean; errors: Tf0592Error[] };
export type Tf0592Options = { allowDraft?: boolean; verifyCandidate?: boolean; sourceChecks?: boolean };
export type FailureClass = 'infrastructure' | 'task' | 'grader' | 'agent';
export type Tf0592Trial = {
  outcome: 'pass' | 'fail' | 'missing' | 'timeout' | 'crash' | 'skip';
  arm?: 'baseline' | 'treatment'; repeat?: number; failureClass?: FailureClass | null;
  tokens?: number; turns?: number; toolCalls?: number; wallClockMs?: number; cost?: number;
};
export type Tf0592Corpus = { cases: Array<{ id: string; taskId: string; safetyRequired?: boolean; anchor?: 'positive' | 'negative' }> };
export type Tf0592RawTrials = { cases: Array<{ caseId: string; failureClass?: FailureClass | null; trials: Array<Tf0592Trial | string> }> };
export type Tf0592Policy = {
  taskSet: { k: number; minimumCompleteCases: number };
  promotion: { thresholds: { passKAbsoluteImprovement: { minimum: number } } };
  budgets: { costCeiling: { maxRelativeIncrease: number } };
};
export type Tf0592Resources = {
  schemaVersion: string; generatedAt: string; driven_by: string; actor: string;
  candidate: { commit: string; tree: string; branch: string; dirty: boolean; dirtyPaths: string[]; sourceHashes: Record<string, string> };
  runtime: { node: string; pnpm: string; platform: string; arch: string; osRelease: string };
  observedResources: { cpuCount: number; totalMemoryBytes: number; freeMemoryBytes: number; disk: { freeBytes: number; totalBytes: number; status: string } };
  envelope: Record<string, unknown>;
};
export type Tf0592Budget = {
  tokensPerCompletedCase: number | null; turnsPerCompletedCase: number | null;
  toolCallsPerCompletedCase: number | null; costPerCompletedCase: number | null;
  wallClockP50Ms: number | null; wallClockP95Ms: number | null; observedTrialCount: number;
  recordedTotals: Record<string, number | null>; incompleteCaseConsumption: Record<string, number | null>;
  completedCaseOnly: Record<string, number | null>; costCeilingRelativeIncrease?: number;
};
export type Tf0592Arm = {
  status: string; trialCount: number; completeCaseCount: number; incompleteCaseCount: number;
  perTask: Array<{ caseId: string; taskId: string; trialCount: number; complete: boolean; status: string; passK: boolean | null; passAtK: boolean | null; trials: Tf0592Trial[] }>;
  aggregate: {
    passK: number | null; passAtK: number | null; perTrialSuccessRate: number | null;
    confidenceInterval95: [number, number] | null; passAtKConfidenceInterval95: [number, number] | null;
    intervalMethod: string; flakeRate: number | null;
    incomplete: Array<{ caseId: string; trialIndex: number; outcome: string }>; reasons: string[];
  };
  failureClasses: Record<FailureClass, { trialCount: number; caseCount: number }>;
  budget: Tf0592Budget;
};
export type Tf0592Summary = {
  status: string; reason: string | null;
  run: { k: number; minimumCompleteCases: number; trialCount: number; baselineTrialCount: number; treatmentTrialCount: number; completeCaseCount: number; incompleteCaseCount: number; cleanStateRequired: boolean };
  perTask: Tf0592Arm['perTask']; aggregate: Tf0592Arm['aggregate']; failureClasses: Tf0592Arm['failureClasses'];
  treatment: Tf0592Arm;
  pairedDiff: { status: string; metric: string; pairUnit: string; inferenceUnit: string; pairCount: number; repeatPairCount: number; completePairCaseCount: number; unmatched: Array<{ caseId: string; repeat: number; baseline: string; treatment: string }>; excludedPartialPairs: Array<{ caseId: string; repeat: number; baseline: number; treatment: number }>; intervalMethod: string; varianceStatus: string; meanDiff: number | null; ci95: [number, number] | null; effectSize: number | null; passKDelta: number | null };
  power: { status: string; method: string; inferenceUnit: string; reason: string; confidenceLevel: number; targetPower: number; minimumDetectableEffect: number; observedDetectableEffect: number | null; requiredCasesApprox: number | null; requiredPairsApprox: number | null; passKPower: string };
  budget: Tf0592Budget;
  claims: { realHuman: boolean; liveProvider: boolean; promotionReady: boolean; productLocksChanged: boolean };
};
export type Tf0592Report = Tf0592Summary & {
  schemaVersion: string; taskId: string; generatedAt: string; driven_by: string; actor: string;
  inputs: { corpusPath: string; rawTrialsPath: string; policyPath: string; systemRunPath: string; hashes: Record<string, string>; corpusCaseCount: number };
  resourceFingerprint: Tf0592Resources;
};
export type Tf0592Control = { id: string; mutation: string; expectedCode: string };
export type Tf0592Controls = { schemaVersion: string; taskId: string; driven_by: string; actor: string; controls: Tf0592Control[] };
export type Tf0592ControlResult = Tf0592Control & { observedCodes: string[]; passed: boolean };
export const TF0592_PACK_DIR: string;
export function wilsonCi95(successes: number, total: number): [number, number] | null;
export function collectResourceFingerprint(root?: string): Tf0592Resources;
export function summarizeTf0592Trials(corpus: Tf0592Corpus, rawTrials: Tf0592RawTrials, policy: Tf0592Policy): Tf0592Summary;
export function buildTf0592Report(root?: string): { inputs: { corpus: Tf0592Corpus; rawTrials: Tf0592RawTrials; policy: Tf0592Policy; hashes: Record<string, string> }; resource: Tf0592Resources; report: Tf0592Report };
export function buildNegativeControls(): Tf0592Controls;
export function validateTf0592Report(report: unknown, root?: string, options?: Tf0592Options): Tf0592Validation;
export function runNegativeControls(report: Tf0592Report, controls?: Tf0592Controls, root?: string): Tf0592ControlResult[];
export function writeTf0592Pack(root?: string): { sealState: string; reportStatus: string; reportValidation: Tf0592Validation; negativeControls: { passed: boolean; count: number; results: Tf0592ControlResult[] } };
export function validateTf0592Pack(root?: string, options?: Tf0592Options): Tf0592Validation & { status: string; completeCaseCount: number | null; negativeControlCount: number };
export function systemRunRawTrials(systemRun: any): any;
