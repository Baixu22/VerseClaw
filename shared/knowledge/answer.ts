import type { SourceRefV2 } from './owner-read-contract.js';

export type KnowledgeAnswerMode = 'strict' | 'open';
export type EvidenceStatusV2 = {
  schema: 'EvidenceStatus/v2';
  exactQuote: 'verified' | 'not-applicable';
  sourcePin: 'verified' | 'not-applicable';
  semanticSupport: 'supported' | 'unsupported' | 'uncertain' | 'unverified' | 'not-applicable';
  verifier?: { actor: 'knowledge-claim-support'; driven_by: 'agent'; runId: string; reason: string };
};
export type CitationV2 = {
  schema: 'Citation/v2';
  sourceId: string;
  quote: string;
  sourceRef: SourceRefV2;
  sourceDigest: string;
  chunkDigest: string;
  quoteDigest: string;
};
export type AnswerClaimV1 = {
  schema: 'AnswerClaim/v1';
  kind: 'source' | 'general' | 'inference';
  text: string;
  citations: CitationV2[];
  evidenceStatus: EvidenceStatusV2;
};
