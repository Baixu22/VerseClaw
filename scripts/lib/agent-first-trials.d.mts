export const TRIAL_FILES: string[];
export function artifactPath(root: string, path: string): string;
export function createTrialPlan(root: string, runDir: string): any;
export function validateTrialManifest(manifest: any, corpus: any, profile: any, registeredAdapters: any): void;
export function loadTrialAdapters(root?: string): any;
export function verifyPlanInputs(manifest: any, root?: string, options?: { retained?: boolean }): void;
export function classifyTrial(worker: any, grades: any[], observation: any, execution: any): { outcome: string; failureClass: string | null };
export function readTrialRecord(manifest: any, runDir: string, entry: any, root?: string): any;
export function runTrialPlan(runDir: string, options?: { root?: string; limit?: number }): Promise<any>;
export function checkTrialRun(runDir: string, options?: { root?: string; write?: boolean; retained?: boolean }): any;
export function retainTrialRun(runDir: string, outputDir: string, options?: { root?: string }): any;
export function verifyRetainedRun(runDir: string, options?: { root?: string }): any;
export function verifyTrialAcceptance(file: string, options?: { root?: string; raw?: string }): any;

export function buildHistoricalTrialPlan(root?: string): {
  corpus: any;
  splitDigest: string;
  trials: Array<{ taskId: string; arm: 'baseline' | 'treatment'; repeat: number; trialId: string }>;
  hiddenTestPaths: string[];
};
export function writeHistoricalManifest(runDir: string, options?: { root?: string; dependenciesRoot?: string; model?: string }): any;
export async function runHistoricalTrial(runDir: string, options?: { root?: string; trialId: string }): Promise<any>;
export function checkHistoricalRun(runDir: string, options?: { root?: string; write?: boolean }): any;

export function retainHistoricalRun(runDir: string, outputDir: string, options?: { root?: string }): any;
