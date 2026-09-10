// SiliconFlow embedding provider for LoCoMo benchmark testing.
// Uses Qwen/Qwen3-Embedding-8B via OpenAI-compatible /v1/embeddings endpoint.
//
// Requires SILICONFLOW_API_KEY environment variable.
// API key is read at call time — never hardcoded.

import type { RuntimeEmbeddingProvider } from "../../../openclaw_runtime/src/runtime-core/memory-embedding-provider.ts";

const SILICONFLOW_BASE = "https://api.siliconflow.cn/v1";
const SILICONFLOW_MODEL = "Qwen/Qwen3-Embedding-8B";
const EMBEDDING_DIM = 4096;

export function hasSiliconFlowKey(): boolean {
  return (
    typeof process.env.SILICONFLOW_API_KEY === "string" &&
    process.env.SILICONFLOW_API_KEY.length > 0
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callEmbeddingAPIWithRetry(
  texts: string[],
  retries = 5,
): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(`${SILICONFLOW_BASE}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SILICONFLOW_API_KEY}`,
        },
        body: JSON.stringify({
          model: SILICONFLOW_MODEL,
          input: texts,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        const err = new Error(
          `SiliconFlow embedding API error ${resp.status}: ${body}`,
        );
        // Retry on 500, 502, 503, 504, 429 (rate limit)
        if (
          resp.status === 500 ||
          resp.status === 502 ||
          resp.status === 503 ||
          resp.status === 504 ||
          resp.status === 429
        ) {
          lastErr = err;
          const backoff = Math.min(
            1000 * Math.pow(2, attempt) + Math.random() * 500,
            30000,
          );
          console.log(
            `[SiliconFlow] Retry ${attempt + 1}/${retries} after ${Math.round(backoff)}ms (HTTP ${resp.status})`,
          );
          await sleep(backoff);
          continue;
        }
        throw err;
      }

      const json = (await resp.json()) as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      return json.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } catch (err) {
      lastErr = err;
      // Network errors (fetch failed, ConnectTimeoutError, etc.) — retry
      const msg = (err as Error).message || "";
      if (
        msg.includes("fetch failed") ||
        msg.includes("ConnectTimeoutError") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET") ||
        msg.includes("socket hang up")
      ) {
        const backoff = Math.min(
          1000 * Math.pow(2, attempt) + Math.random() * 500,
          30000,
        );
        console.log(
          `[SiliconFlow] Retry ${attempt + 1}/${retries} after ${Math.round(backoff)}ms (network: ${msg.slice(0, 80)})`,
        );
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("SiliconFlow embedding API failed after retries");
}

export function createSiliconFlowEmbeddingProvider(): RuntimeEmbeddingProvider {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY not set");
  }

  return {
    id: "siliconflow-qwen3-embed-8b",
    dimension: EMBEDDING_DIM,
    embedQuery: async (text: string) => {
      const result = await callEmbeddingAPIWithRetry([text]);
      return result[0];
    },
    embedBatch: async (texts: string[]) => {
      const batchSize = 8; // reduced from 32 to avoid 500 errors
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await callEmbeddingAPIWithRetry(batch);
        results.push(...batchResults);
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < texts.length) {
          await sleep(200);
        }
      }
      return results;
    },
  };
}
