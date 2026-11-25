import type { FrozenRagBundle } from './project-rag-corpus.mjs';
export const RAG_QUERY_EVALUATOR_VERSION: 'owner-support-coverage/v3';
export type RagQueryGrade = { queryId: string; evaluatorVersion: typeof RAG_QUERY_EVALUATOR_VERSION; ndcg5: number; recallAt20: number;
  overlapRecallAt20: number; supportCoverageAt20: number; exactRefPrecision: number; safetyViolations: number; gradingMode: string };
export type RagQueryBundle = Pick<FrozenRagBundle, 'root'> & {
  corpus: { sources: Array<Pick<FrozenRagBundle['corpus']['sources'][number], 'ref' | 'path'>> };
  gold: Array<{ queryId: string; facts: Array<Pick<FrozenRagBundle['gold'][number]['facts'][number], 'sourceRef' | 'support'>> }>;
};
export function gradeRagQuery(bundle: RagQueryBundle, queryId: string, observation: unknown): RagQueryGrade;
