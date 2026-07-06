import type { RuntimeEmbeddingProvider } from "../runtime-core/memory-embedding-provider.js";
import type { MemoryEmbeddingProvider } from "../plugins/memory-embedding-providers.js";

/**
 * Adapt the upper-layer MemoryEmbeddingProvider to the runtime-core
 * RuntimeEmbeddingProvider contract. dimension is probed separately because
 * MemoryEmbeddingProvider does not expose dimension in its interface.
 */
export function adaptMemoryEmbeddingProvider(
  provider: MemoryEmbeddingProvider,
  dimension: number,
): RuntimeEmbeddingProvider {
  return {
    id: provider.id,
    dimension,
    embedQuery: (text) => provider.embedQuery(text),
    embedBatch: (texts) => provider.embedBatch(texts),
    close: provider.close,
  };
}

/**
 * Probe the dimension by embedding a single placeholder query.
 * Call this once at setup time, then pass the result to adaptMemoryEmbeddingProvider.
 */
export async function probeEmbeddingDimension(
  provider: MemoryEmbeddingProvider,
): Promise<number> {
  const [vec] = await provider.embedBatch(["dimension probe"]);
  if (!vec || vec.length === 0) {
    throw new Error(`Embedding provider ${provider.id} returned empty vector`);
  }
  return vec.length;
}
