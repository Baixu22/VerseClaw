import type { RuntimeEmbeddingProvider } from '../../openclaw_runtime/src/runtime-core/memory-embedding-provider';
import { proxyAwareFetch } from '../utils/proxy-fetch';

const DEFAULT_SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1';
const DEFAULT_SILICONFLOW_MODEL = 'Qwen/Qwen3-Embedding-8B';
const DEFAULT_EMBEDDING_DIMENSION = 4096;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BATCH_SIZE = 8;

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
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    id: 'siliconflow-qwen3-embed-8b',
    dimension: DEFAULT_EMBEDDING_DIMENSION,
    embedQuery: async (text: string) => (await request([text]))[0],
    embedBatch: async (texts: string[]) => {
      const results: number[][] = [];
      for (let index = 0; index < texts.length; index += MAX_BATCH_SIZE) {
        const batch = texts.slice(index, index + MAX_BATCH_SIZE);
        results.push(...await request(batch));
      }
      return results;
    },
  };
}
