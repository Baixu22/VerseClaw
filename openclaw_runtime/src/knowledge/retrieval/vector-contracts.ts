import type { SourceRefV2 } from "../../runtime-core/knowledge-owner-read.js";
import type { EmbeddingSpaceV1 } from "./embedding-space.js";

export type VectorBackendId = "sqlite-flat" | "lancedb-ann";

/** A derived vector carries identifiers and filter facts, never an answerable excerpt. */
export type VectorProjectionV1 = {
  schema: "VectorProjection/v1";
  id: string;
  generationId: string;
  workspaceId: string;
  namespaceId: string;
  spaceId: string;
  chunkId: string;
  chunkDigest: string;
  sourceGeneration: string;
  source: SourceRefV2;
  vector: number[];
};

export type VectorGenerationV1 = {
  schema: "VectorGeneration/v1";
  generationId: string;
  namespaceId: string;
  workspaceId: string;
  spaceId: string;
  backend: VectorBackendId;
  intentSequence: number;
  state: "building" | "active" | "retired" | "failed";
  rowCount: number;
};

export type VectorSearchV1 = {
  namespaceId: string;
  workspaceId: string;
  generationId: string;
  space: EmbeddingSpaceV1;
  vector: number[];
  limit: number;
  /** The current SQLite owner generation supplies the eligible subset before scoring. */
  eligibleIds: string[];
  signal?: AbortSignal;
  exact?: boolean;
};

export type VectorHit = { id: string; distance: number };
export type IndexBackendCapabilitiesV1 = {
  schema: "IndexBackendCapabilities/v1";
  backend: VectorBackendId;
  available: boolean;
  platform: string;
  arch: string;
  maxReferenceRows: number;
  prefilter: true;
  includesUnindexedRows: true;
  reason?: string;
};

/** Core composes this contract; native library ownership stays with its adapter. */
export type VectorProjectionBackend = {
  id: VectorBackendId;
  capability: () => Promise<IndexBackendCapabilitiesV1>;
  hasGeneration: (
    generation: VectorGenerationV1,
    expectedIds: ReadonlySet<string>,
  ) => Promise<boolean>;
  write: (
    generation: VectorGenerationV1,
    space: EmbeddingSpaceV1,
    rows: VectorProjectionV1[],
    signal?: AbortSignal,
  ) => Promise<void>;
  search: (query: VectorSearchV1) => Promise<VectorHit[]>;
  optimize: (generation: VectorGenerationV1, signal?: AbortSignal) => Promise<void>;
  deleteRows: (generation: VectorGenerationV1, ids: string[]) => Promise<void>;
  remove: (generation: VectorGenerationV1) => Promise<void>;
  close: () => Promise<void> | void;
};
