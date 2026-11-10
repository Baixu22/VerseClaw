import type {
  SourceRefV2,
  ReadAdmissionContextV1,
} from "../../runtime-core/knowledge-owner-read.js";
import type { KnowledgeChunkV2 } from "./contracts.js";

export type ProjectionSourceIntent = {
  source: SourceRefV2;
  profileDigest: string;
  eligible: boolean;
  eventId: string;
  reason?: string;
  deadlineAt: number;
  force?: boolean;
};

export type ProjectionIndexJob = {
  schema: "IndexJob/v1";
  jobId: string;
  sourceKey: string;
  source: SourceRefV2;
  profileDigest: string;
  intentSequence: number;
  state: "pending" | "leased" | "complete" | "failed" | "superseded";
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  deadlineAt: number;
  nextAttemptAt: number;
  error: string | null;
};

export type ProjectionSourceState = {
  sourceKey: string;
  source: SourceRefV2;
  profileDigest: string;
  intentSequence: number;
  eligible: boolean;
  desiredEligible: boolean;
  activeGeneration: string | null;
  reason: string | null;
};

export type ProjectionGeneration = {
  schema: "ProjectionGeneration/v1";
  generationId: string;
  sourceKey: string;
  intentSequence: number;
  state: "building" | "active" | "retired" | "failed";
  chunkCount: number;
};

export type ProjectionSearchInput = {
  namespaceId: string;
  query: string;
  limit: number;
  context: ReadAdmissionContextV1;
};

export type ProjectionSearchResult = {
  status: "available" | "unavailable";
  reason?: string;
  // These owner-bound candidates still require a current owner read before publication.
  candidates: Array<{ generationId: string; chunk: KnowledgeChunkV2; lexicalRank: number }>;
};
