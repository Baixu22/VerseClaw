import type { RuntimeEmbeddingProvider } from '../../openclaw_runtime/src/runtime-core/memory-embedding-provider';
import { proxyAwareFetch } from '../utils/proxy-fetch';

const DEFAULT_SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1';
const DEFAULT_SILICONFLOW_MODEL = 'Qwen/Qwen3-Embedding-8B';
const DEFAULT_EMBEDDING_DIMENSION = 4096;
/** Per-batch ceiling. This is NOT the total operation budget. */
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BATCH_SIZE = 8;
/** Default total budget for one embedding operation (query + all batches). */
export const DEFAULT_EMBEDDING_DEADLINE_MS = 120_000;

export type KnowledgeEmbeddingDeadlineOptions = {
  /** Total operation budget. `Number.POSITIVE_INFINITY` is test-only. */
  deadlineMs?: number;
  /** Test seams. */
  now?: () => number;
  requestImpl?: typeof proxyAwareFetch;
};

/**
 * Structured failure for a total-deadline expiry. Partial vectors are never
 * returned: the caller must fall back to lexical ranking rather than rank a
 * partially-embedded corpus.
 */
export class KnowledgeEmbeddingDeadlineError extends Error {
  readonly code = 'KNOWLEDGE_EMBEDDING_DEADLINE_EXCEEDED';
  readonly deadlineMs: number;
  readonly completedBatches: number;
  readonly totalBatches: number;

  constructor(params: {
    deadlineMs: number;
    completedBatches: number;
    totalBatches: number;
  }) {
    super(
      `Knowledge embedding deadline exceeded after ${params.completedBatches}/${params.totalBatches} batches ` +
        `(deadline ${params.deadlineMs}ms)`,
    );
    this.name = 'KnowledgeEmbeddingDeadlineError';
    this.deadlineMs = params.deadlineMs;
    this.completedBatches = params.completedBatches;
    this.totalBatches = params.totalBatches;
  }
}

export function resolveEmbeddingDeadlineMs(value: string | undefined): number {
  if (!value) return DEFAULT_EMBEDDING_DEADLINE_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EMBEDDING_DEADLINE_MS;
  return parsed;
}

export function hasSiliconFlowEmbeddingProvider(): boolean {
  return Boolean(process.env.SILICONFLOW_API_KEY);
}

export function createSiliconFlowEmbeddingProvider(
  options: KnowledgeEmbeddingDeadlineOptions = {},
): RuntimeEmbeddingProvider {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error('SILICONFLOW_API_KEY is not configured');
  }

  const baseUrl = process.env.SILICONFLOW_BASE_URL?.trim() || DEFAULT_SILICONFLOW_BASE;
  const model = process.env.SILICONFLOW_EMBEDDING_MODEL?.trim() || DEFAULT_SILICONFLOW_MODEL;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/embeddings`;
  const deadlineMs = options.deadlineMs ?? DEFAULT_EMBEDDING_DEADLINE_MS;
  const now = options.now ?? Date.now;
  const requestImpl = options.requestImpl ?? proxyAwareFetch;
  const startedAt = now();

  /** Milliseconds left in the operation budget, or 0 once exhausted. */
  const remainingMs = (): number => {
    if (deadlineMs === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    return Math.max(0, deadlineMs - (now() - startedAt));
  };

  const request = async (
    texts: string[],
    completedBatches: number,
    totalBatches: number,
  ): Promise<number[][]> => {
    const remaining = remainingMs();
    if (remaining <= 0) {
      throw new KnowledgeEmbeddingDeadlineError({ deadlineMs, completedBatches, totalBatches });
    }
    const controller = new AbortController();
    // The per-request ceiling may never exceed what is left of the total budget.
    const requestTimeoutMs = Math.min(REQUEST_TIMEOUT_MS, remaining);
    const timeout = Number.isFinite(requestTimeoutMs)
      ? setTimeout(() => controller.abort(), requestTimeoutMs)
      : undefined;
    try {
      const response = await requestImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`SiliconFlow embedding request failed (${response.status}): ${body}`);
      }
      const json = (await response.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
      };
      const rows = json.data ?? [];
      if (rows.length !== texts.length) {
        throw new Error(`SiliconFlow embedding response count mismatch: expected ${texts.length}, received ${rows.length}`);
      }
      return rows
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .map((row) => {
          if (!Array.isArray(row.embedding) || row.embedding.length === 0) {
            throw new Error('SiliconFlow embedding response contained an empty vector');
          }
          return row.embedding;
        });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new KnowledgeEmbeddingDeadlineError({ deadlineMs, completedBatches, totalBatches });
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  return {
    id: 'siliconflow-qwen3-embed-8b',
    dimension: DEFAULT_EMBEDDING_DIMENSION,
    embedQuery: async (text: string) => (await request([text], 0, 1))[0],
    embedBatch: async (texts: string[]) => {
      const totalBatches = Math.ceil(texts.length / MAX_BATCH_SIZE);
      const results: number[][] = [];
      for (let index = 0, completedBatches = 0; index < texts.length; index += MAX_BATCH_SIZE, completedBatches += 1) {
        // Check before every batch so an expired budget never starts a new request.
        if (remainingMs() <= 0) {
          throw new KnowledgeEmbeddingDeadlineError({ deadlineMs, completedBatches, totalBatches });
        }
        const batch = texts.slice(index, index + MAX_BATCH_SIZE);
        results.push(...await request(batch, completedBatches, totalBatches));
      }
      return results;
    },
  };
}
