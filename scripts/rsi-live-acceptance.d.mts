export type LiveTaskIdentity = { id: string; base: string; reference: string; productChanges: string[]; originalDecision: string | null;
  sourceRecord: string; sourceRecordDigest: string; oraclePaths: string[]; commands: string[] };
export type CalibrationStage = { passed: boolean; failureClass?: 'assertion' | 'infrastructure' | 'target-module-absent' | 'oracle-input-drift' | null; timedOut?: boolean; commands?: string[]; oracleUnchanged?: boolean; oracleRevision?: string | null; oracleTestDigests?: Record<string, string> | null;
  executions?: Array<{ command?: string; kind?: string; error?: string | null; exitCode: number | null; timedOut?: boolean; report?: { numFailedTests?: number; [key: string]: unknown } | null }>;
  diagnostics?: Array<{ kind: string; missingPath?: string; importer?: string | null; inTargetScope?: boolean; message?: string }> };
export function codingCohortFor(root: string, directory: string): boolean;
export function inspectLiveCorpus(root?: string, options?: { codingCohort?: boolean }): LiveTaskIdentity[];
export function assessTaskAdmission(input: { reference?: CalibrationStage; baseline?: CalibrationStage }): { passed: boolean; issues: string[]; warnings?: string[] };
export function probeLiveResource(input: { directory: string; endpoint: string; model: string; apiKey: string;
  campaignLedger?: ReturnType<typeof import('./lib/rsi-campaign-budget.mjs').createCampaignLedger> }): Promise<{ passed: boolean; [key: string]: unknown }>;
export function calibrateLiveTask(root: string, directory: string, taskId: string, options?: { timeoutMs?: number; codingCohort?: boolean; supportRoot?: string }): Promise<{
  taskId: string; source: LiveTaskIdentity; stages: Record<string, CalibrationStage>; admission: { passed: boolean; issues: string[] };
}>;
export function finalizeLiveAdmission(root: string, directory: string, options?: { write?: boolean }): { status: 'NO_GO' | 'ready-for-measurement'; admissions: Array<{ taskId: string; passed: boolean; status: string; issues: string[]; admissionDigest?: string }>;
  provider: { status: string; receipt: string; responseId: string | null; usage: Record<string, unknown> | null };
  trialSlots: Array<{ taskId: string; repeat: number; arm: string; status: 'not-run'; reason: string }>; claims: Record<string, boolean> };
export function checkLiveAcceptance(root: string, directory: string): { passed: boolean; errors: string[]; acceptanceStatus: string; measuredTaskTrials: number; unexecutedSlots: number | null; benefitClaim: false };
