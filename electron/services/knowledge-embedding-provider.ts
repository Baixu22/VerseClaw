import type { RuntimeEmbeddingProvider } from '../../openclaw_runtime/src/runtime-core/memory-embedding-provider';
import { createHash } from 'node:crypto';
import { proxyAwareFetch } from '../utils/proxy-fetch';

const DEFAULT_SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1';
const DEFAULT_SILICONFLOW_MODEL = 'Qwen/Qwen3-Embedding-8B';
const DEFAULT_EMBEDDING_DIMENSION = 4096;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BATCH_SIZE = 8;
// Content addressing covers source edits; credential/model/endpoint scope prevents
// cross-provider reuse. This cache is disposable, never an accepted knowledge store.
const vectors = new Map<string, number[]>();
const MAX_CACHED_VECTORS = 256;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function hasSiliconFlowEmbeddingProvider(): boolean {
  return Boolean(process.env.SILICONFLOW_API_KEY);
}

export function createSiliconFlowEmbeddingProvider(): RuntimeEmbeddingProvider {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error('SILICONFLOW_API_KEY is not configured');
  }

  const baseUrl = process.env.SILICONFLOW_BASE_URL?.trim() || DEFAULT_SILICONFLOW_BASE;
  const model = process.env.SILICONFLOW_EMBEDDING_MODEL?.trim() || DEFAULT_SILICONFLOW_MODEL;
  const endpoint = `${baseUrl.replace(/\/$/, '')}/embeddings`;
  const scope = digest(JSON.stringify([endpoint, model, apiKey]));

  const request = async (texts: string[]): Promise<number[][]> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await proxyAwareFetch(endpoint, {
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
    } finally {
      clearTimeout(timeout);
    }
  };

  const cached = async (texts: string[]): Promise<number[][]> => {
    const keys = texts.map(text => `${scope}:${digest(text)}`);
    const available = new Map(keys.flatMap(key => vectors.has(key) ? [[key, vectors.get(key)!] as const] : []));
    const missing = [...new Map(texts.flatMap((text, index) => vectors.has(keys[index]) ? [] : [[keys[index], text] as const])).entries()];
    for (let index = 0; index < missing.length; index += MAX_BATCH_SIZE) {
      const batch = missing.slice(index, index + MAX_BATCH_SIZE);
      const result = await request(batch.map(([, text]) => text));
      batch.forEach(([key], row) => {
        available.set(key, result[row]);
        vectors.set(key, [...result[row]]);
        while (vectors.size > MAX_CACHED_VECTORS) vectors.delete(vectors.keys().next().value!);
      });
    }
    return keys.map(key => {
      const vector = available.get(key)!;
      vectors.delete(key); vectors.set(key, vector);
      while (vectors.size > MAX_CACHED_VECTORS) vectors.delete(vectors.keys().next().value!);
      return [...vector];
    });
  };

  return {
    id: `siliconflow:${model}:${digest(endpoint).slice(0, 12)}`,
    dimension: DEFAULT_EMBEDDING_DIMENSION,
    embedQuery: async (text: string) => (await cached([text]))[0],
    embedBatch: async (texts: string[]) => {
      const results: number[][] = [];
      for (let index = 0; index < texts.length; index += MAX_BATCH_SIZE) {
        const batch = texts.slice(index, index + MAX_BATCH_SIZE);
        results.push(...await cached(batch));
      }
      return results;
    },
  };
}
