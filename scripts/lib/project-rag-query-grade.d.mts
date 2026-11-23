import type { FrozenRagBundle } from './project-rag-corpus.mjs';
export function gradeRagQuery(bundle: FrozenRagBundle, queryId: string, observation: unknown): { queryId: string; ndcg5: number; recallAt20: number; exactRefPrecision: number; safetyViolations: number; gradingMode: string };
