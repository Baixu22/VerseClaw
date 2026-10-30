import type { TaskCorpus } from './lib/rsi-historical-task-corpus.mjs';
export type TaskCorpusValidation = { schemaVersion: string; driven_by: string; actor: string; candidate: { commit: string; tree: string; dirty: boolean }; corpus: { passed: boolean; errors: string[] }; taskCount: number; distribution: TaskCorpus['distribution']; calibration: { passed: boolean; rowCount: number; rubricRunStatus: string }; claims: Record<string, boolean> };
export function writeTaskCorpusPack(root?: string): TaskCorpusValidation;
export function runModelCalibration(root?: string, resource?: { endpoint?: string; apiKey?: string }): Promise<TaskCorpusValidation>;
export function registerTaskCorpus(root?: string): { violations: Array<{ code: string; path: string; message: string }>; counts: Record<string, number> };
export function validateTaskCorpusPack(root?: string, options?: { allowDraft?: boolean }): { passed: boolean; errors: string[]; taskCount: number | null; calibratedRows: number };
