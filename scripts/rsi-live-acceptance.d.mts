export type LiveTaskIdentity = { id: string; base: string; reference: string; productChanges: string[]; originalDecision: string | null;
  sourceRecord: string; sourceRecordDigest: string; oraclePaths: string[]; commands: string[] };
export type CalibrationStage = { passed: boolean; commands?: string[]; oracleUnchanged?: boolean;
  executions?: Array<{ command?: string; kind?: string; error?: string | null; exitCode: number | null; timedOut?: boolean; report?: { numFailedTests?: number; [key: string]: unknown } | null }> };
export function inspectLiveCorpus(root?: string): LiveTaskIdentity[];
export function assessTaskAdmission(input: { reference?: CalibrationStage; baseline?: CalibrationStage }): { passed: boolean; issues: string[] };
export function probeLiveResource(input: { directory: string; endpoint: string; model: string; apiKey: string }): Promise<{ passed: boolean; [key: string]: unknown }>;
export function calibrateLiveTask(root: string, directory: string, taskId: string, options?: { timeoutMs?: number }): Promise<{
  taskId: string; source: LiveTaskIdentity; stages: Record<string, CalibrationStage>; admission: { passed: boolean; issues: string[] };
}>;
export function finalizeLiveAdmission(root: string, directory: string): { status: 'NO_GO' | 'ready-for-measurement'; admissions: Array<{ taskId: string; passed: boolean; issues: string[] }>;
  trialSlots: Array<{ taskId: string; repeat: number; arm: string; status: 'not-run' }>; claims: Record<string, boolean> };
