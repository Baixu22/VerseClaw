// @vitest-environment node
/**
 * TF-0735: one total deadline for the whole knowledge embedding operation.
 *
 * The per-batch 30s ceiling is unchanged, but it may never extend past the
 * caller's total budget, and an exhausted budget must not start another batch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EMBEDDING_DEADLINE_MS,
  KnowledgeEmbeddingDeadlineError,
  createSiliconFlowEmbeddingProvider,
  resolveEmbeddingDeadlineMs,
} from '../../electron/services/knowledge-embedding-provider';

function embeddings(count: number, dimension = 4): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, (_, index) => ({
        index,
        embedding: Array.from({ length: dimension }, (_, d) => index + d / 10),
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('TF-0735 knowledge embedding total deadline', () => {
  beforeEach(() => {
    process.env.SILICONFLOW_API_KEY = 'sk-test';
  });

  afterEach(() => {
    delete process.env.SILICONFLOW_API_KEY;
  });

  it('caps a 100-text / 13-batch operation at the 120s total deadline', async () => {
    let clock = 0;
    const requestImpl = vi.fn(async () => {
      // Simulate every batch taking the full 30s per-request ceiling.
      clock += 30_000;
      return embeddings(8);
    });
    const provider = createSiliconFlowEmbeddingProvider({
      deadlineMs: 120_000,
      now: () => clock,
      requestImpl: requestImpl as never,
    });

    await expect(provider.embedBatch(Array.from({ length: 100 }, (_, i) => `doc-${i}`)))
      .rejects.toBeInstanceOf(KnowledgeEmbeddingDeadlineError);
    expect(clock).toBeLessThanOrEqual(120_000);
    // Four 30s batches fit exactly; the fifth is never started.
    expect(requestImpl).toHaveBeenCalledTimes(4);
  });

  it('does not start another batch after the budget is exhausted', async () => {
    let clock = 0;
    const requestImpl = vi.fn(async () => {
      clock += 30_000;
      return embeddings(8);
    });
    const provider = createSiliconFlowEmbeddingProvider({
      deadlineMs: 60_000,
      now: () => clock,
      requestImpl: requestImpl as never,
    });

    const error = await provider.embedBatch(Array.from({ length: 100 }, (_, i) => `doc-${i}`))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KnowledgeEmbeddingDeadlineError);
    const deadlineError = error as KnowledgeEmbeddingDeadlineError;
    expect(deadlineError.code).toBe('KNOWLEDGE_EMBEDDING_DEADLINE_EXCEEDED');
    expect(deadlineError.deadlineMs).toBe(60_000);
    expect(deadlineError.completedBatches).toBe(2);
    expect(deadlineError.totalBatches).toBe(13);
    expect(requestImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects instead of returning partial vectors when a later batch fails', async () => {
    const requestImpl = vi.fn()
      .mockResolvedValueOnce(embeddings(8))
      .mockRejectedValueOnce(new Error('upstream reset'));
    const provider = createSiliconFlowEmbeddingProvider({
      deadlineMs: 120_000,
      now: () => 0,
      requestImpl: requestImpl as never,
    });

    await expect(provider.embedBatch(Array.from({ length: 20 }, (_, i) => `doc-${i}`)))
      .rejects.toThrow('upstream reset');
    // No partial array is returned to the caller.
    expect(requestImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one budget between embedQuery and the following batch', async () => {
    let clock = 0;
    const requestImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      // Each request consumes 30s; the caller's other work consumes 60s.
      clock += 30_000;
      return embeddings(body.input.length);
    });
    const provider = createSiliconFlowEmbeddingProvider({
      deadlineMs: 120_000,
      now: () => clock,
      requestImpl: requestImpl as never,
    });

    await provider.embedQuery('query'); // consumes 30s
    clock += 60_000; // the caller's other work also shares the budget
    const error = await provider.embedBatch(Array.from({ length: 9 }, (_, i) => `doc-${i}`))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KnowledgeEmbeddingDeadlineError);
    expect(requestImpl).toHaveBeenCalledTimes(2);
    expect(clock).toBeLessThanOrEqual(120_000);
  });

  it('parses the configured deadline and falls back to 120s', () => {
    expect(resolveEmbeddingDeadlineMs(undefined)).toBe(DEFAULT_EMBEDDING_DEADLINE_MS);
    expect(resolveEmbeddingDeadlineMs('90000')).toBe(90_000);
    expect(resolveEmbeddingDeadlineMs('0')).toBe(DEFAULT_EMBEDDING_DEADLINE_MS);
    expect(resolveEmbeddingDeadlineMs('not-a-number')).toBe(DEFAULT_EMBEDDING_DEADLINE_MS);
  });
});
