import type { KnowledgeAnswerMode } from "./answer.js";
import type { KnowledgeEmbeddingStatus } from "./embedding.js";
import type { KnowledgeRerankStatus } from "./rerank.js";
import type { RetrievalProfile } from "./retrieval.js";
import type { KnowledgeVectorStatus } from "./vector.js";

export type ProjectRagConfigInput = {
  profile?: RetrievalProfile;
  answerMode?: KnowledgeAnswerMode;
  maxStorageBytes?: number;
};
export type ProjectRagConfigV2 = Required<ProjectRagConfigInput> & {
  schema: "ProjectRagConfig/v2";
};
export const PROJECT_RAG_DEFAULTS: ProjectRagConfigV2 = Object.freeze({
  schema: "ProjectRagConfig/v2",
  profile: "local",
  answerMode: "strict",
  maxStorageBytes: 512 * 1024 * 1024,
});

/** Scope and interaction mode remain request facts, outside persistent configuration. */
export function normalizeProjectRagConfig(input: unknown): ProjectRagConfigV2 {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid retrieval configuration");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["profile", "answerMode", "maxStorageBytes"].includes(key)))
    throw new Error("Unknown retrieval configuration key");
  if (
    value.profile !== undefined &&
    (typeof value.profile !== "string" || !["local", "quality", "research"].includes(value.profile))
  )
    throw new Error("Invalid retrieval profile");
  if (
    value.answerMode !== undefined &&
    (typeof value.answerMode !== "string" || !["strict", "open"].includes(value.answerMode))
  )
    throw new Error("Invalid retrieval answer mode");
  if (
    value.maxStorageBytes !== undefined &&
    (!Number.isSafeInteger(value.maxStorageBytes) ||
      (value.maxStorageBytes as number) < 1024 * 1024 ||
      (value.maxStorageBytes as number) > 64 * 1024 ** 3)
  )
    throw new Error("Invalid index storage budget");
  return {
    schema: "ProjectRagConfig/v2",
    profile: (value.profile as RetrievalProfile | undefined) ?? PROJECT_RAG_DEFAULTS.profile,
    answerMode:
      (value.answerMode as KnowledgeAnswerMode | undefined) ?? PROJECT_RAG_DEFAULTS.answerMode,
    maxStorageBytes:
      (value.maxStorageBytes as number | undefined) ?? PROJECT_RAG_DEFAULTS.maxStorageBytes,
  };
}

export type IndexStatusV1 = {
  schema: "IndexStatus/v1";
  status: "running" | "paused" | "degraded" | "stopped" | "disabled" | "unavailable";
  lastError: string | null;
  sources: Array<{
    sourceKey: string;
    intentSequence: number;
    eligible: boolean;
    activeGeneration: string | null;
    reason: string | null;
  }>;
  jobs: Array<{
    jobId: string;
    state: "pending" | "leased" | "complete" | "failed" | "superseded";
    attempt: number;
    error: string | null;
  }>;
  activeWorker: boolean;
  workerThreadIds: number[];
  lagCount: number;
  logicalDeletedCount: number;
  cleanupPendingGenerations: number;
  storage: { bytes: number | null; budgetBytes: number | null; budgetExceeded: boolean | null };
};
export type RetrievalCapabilitySnapshotV1 = {
  schema: "RetrievalCapabilitySnapshot/v1";
  owner: { namespaceId: string; workspaceId: string; sessionId: string };
  config: ProjectRagConfigV2;
  status: "enabled" | "ready" | "degraded" | "disabled";
  reasons: string[];
  index: IndexStatusV1;
  embedding?: KnowledgeEmbeddingStatus;
  vector?: KnowledgeVectorStatus;
  rerank?: KnowledgeRerankStatus;
};
export type KnowledgeOperationsResult = {
  success: boolean;
  error?: string;
  operations?: RetrievalCapabilitySnapshotV1;
};
export type KnowledgeOperationsConfigureResult = {
  success: boolean;
  error?: string;
  config?: ProjectRagConfigV2;
  restartRequired?: boolean;
};
export type KnowledgeIndexResult = { success: boolean; error?: string; index?: IndexStatusV1 };
