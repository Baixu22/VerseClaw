import type { SourceRefV2 } from "./knowledge-owner-read.js";

export type KnowledgeEvidenceCitation = {
  refId: string;
  intentId?: string;
  sourceRef: SourceRefV2;
  sourceDigest: string;
  chunkDigest: string;
  retainedBodyChars: number;
  retainedBodyUtf8Bytes: number;
};
export type KnowledgeCandidatePackingV2 = {
  schema: "KnowledgeCandidatePacking/v2";
  unitId: string;
  citations: KnowledgeEvidenceCitation[];
};
export type RetainedEvidenceUnit = KnowledgeCandidatePackingV2 & {
  candidateId: string;
  ordinal: number;
  projectionDigest: string;
  retainedChars: number;
  retainedUtf8Bytes: number;
  estimatedTokens: number;
};
export type RetainedEvidenceManifestV1 = {
  schema: "RetainedEvidenceManifest/v1";
  turnId: string;
  estimateMethod: "utf8-bytes-div4";
  units: RetainedEvidenceUnit[];
  retainedChars: number;
  retainedUtf8Bytes: number;
  estimatedTokens: number;
};
