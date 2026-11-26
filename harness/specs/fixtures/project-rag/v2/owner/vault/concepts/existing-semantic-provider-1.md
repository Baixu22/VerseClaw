---
title: existing-semantic-provider / electron/services/knowledge-embedding-provider.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T23:01:31.258Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: electron/services/knowledge-embedding-provider.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import type { RuntimeEmbeddingProvider } from '../../openclaw_runtime/src/runtime-core/memory-embedding-provider';
import { createHash } from 'node:crypto';
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
// Content addressing covers source edits; credential/model/endpoint scope prevents
// cross-provider reuse. This cache is disposable, never an accepted knowledge store.
const vectors = new Map<string, number[]>();
const MAX_CACHED_VECTORS = 256;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

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
  // An injected transport may return a different corpus/vector space; never
  // reuse production or another injected transport's cached result.
  const cache = options.requestImpl ? new Map<string, number[]>() : vectors;
  const startedAt = now();
  const scope = digest(JSON.stringify([endpoint, model, apiKey]));

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
        throw new Error(`SiliconFlow embedding request failed (${response.status})`);
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
        .map((row, index) => {
          if (row.index !== undefined && row.index !== index) throw new Error('SiliconFlow embedding response index mismatch');
          if (!Array.isArray(row.embedding) || row.embedding.length === 0 || row.embedding.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
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

  const cached = async (texts: string[], completedBatches = 0, totalBatches = Math.ceil(texts.length / MAX_BATCH_SIZE)): Promise<number[][]> => {
    if (remainingMs() <= 0) throw new KnowledgeEmbeddingDeadlineError({ deadlineMs, completedBatches, totalBatches });
    const keys = texts.map(text => `${scope}:${digest(text)}`);
    const available = new Map(keys.flatMap(key => cache.has(key) ? [[key, cache.get(key)!] as const] : []));
    const missing = [...new Map(texts.flatMap((text, index) => cache.has(keys[index]) ? [] : [[keys[index], text] as const])).entries()];
    for (let index = 0; index < missing.length; index += MAX_BATCH_SIZE) {
      const batch = missing.slice(index, index + MAX_BATCH_SIZE);
      const result = await request(batch.map(([, text]) => text), completedBatches + Math.floor(index / MAX_BATCH_SIZE), totalBatches);
      batch.forEach(([key], row) => {
        available.set(key, result[row]);
        cache.set(key, [...result[row]]);
        while (cache.size > MAX_CACHED_VECTORS) cache.delete(cache.keys().next().value!);
      });
    }
    return keys.map(key => {
      const vector = available.get(key)!;
      cache.delete(key); cache.set(key, vector);
      while (cache.size > MAX_CACHED_VECTORS) cache.delete(cache.keys().next().value!);
      return [...vector];
    });
  };

  return {
    id: `siliconflow:${model}:${digest(endpoint).slice(0, 12)}`,
    dimension: DEFAULT_EMBEDDING_DIMENSION,
    embedQuery: async (text: string) => (await cached([text]))[0],
    embedBatch: async (texts: string[]) => {
      const totalBatches = Math.ceil(texts.length / MAX_BATCH_SIZE);
      const results: number[][] = [];
      for (let index = 0, completedBatches = 0; index < texts.length; index += MAX_BATCH_SIZE, completedBatches += 1) {
        // Check before every batch so an expired budget never starts a new request.
        if (remainingMs() <= 0) {
          throw new KnowledgeEmbeddingDeadlineError({ deadlineMs, completedBatches, totalBatches });
        }
        const batch = texts.slice(index, index + MAX_BATCH_SIZE);
        results.push(...await cached(batch, completedBatches, totalBatches));
      }
      return results;
    },
  };
}

~~~
