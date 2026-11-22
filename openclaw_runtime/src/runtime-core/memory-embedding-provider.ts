// Runtime-core embedding provider interface (dependency injection boundary).
//
// runtime-core cannot import from extensions/ or plugins/. This interface
// defines the minimal contract that the HybridSearchIndex needs to swap its
// 3-gram TF-IDF vector path for a real embedding model. Upper layers
// (extensions/memory-core) adapt their MemoryEmbeddingProvider to this type.
//
// When no provider is available (NO_EMBEDDING_PROVIDER), the HybridSearchIndex
// falls back to character 3-gram TF-IDF — preserving zero-regression behavior
// for all existing tests and for users who have not configured an embedding
// provider in Settings.

import type { SourceRefV2 } from "./knowledge-owner-read.js";

export type RuntimeEmbeddingProvider = {
  /** Stable provider identifier (e.g. "openai", "ollama"). */
  id: string;
  /** Embedding dimension (e.g. 1536 for text-embedding-3-small). */
  dimension: number;
  /** Embed a single query string. */
  embedQuery: (text: string) => Promise<number[]>;
  /** Embed a batch of document strings. */
  embedBatch: (texts: string[]) => Promise<number[][]>;
  /** Owner-pinned document path for providers whose lifecycle belongs to the source owner. */
  embedSources?: (sources: SourceRefV2[]) => Promise<number[][]>;
  /** Optional cleanup hook (close HTTP clients, free resources). */
  close?: () => Promise<void> | void;
};

/**
 * Sentinel marking "no embedding provider configured". Distinct from undefined
 * so callers can distinguish "explicitly disabled" from "not yet decided".
 */
export const NO_EMBEDDING_PROVIDER: unique symbol = Symbol("no-embedding");

export type EmbeddingProviderOrNone = RuntimeEmbeddingProvider | typeof NO_EMBEDDING_PROVIDER;

export function isEmbeddingProviderAvailable(
  provider: EmbeddingProviderOrNone,
): provider is RuntimeEmbeddingProvider {
  return provider !== NO_EMBEDDING_PROVIDER;
}
