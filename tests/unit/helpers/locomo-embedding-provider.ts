// Opt-in local deployment for LoCoMo only. Never changes product memory defaults.
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { RuntimeEmbeddingProvider } from "../../../openclaw_runtime/src/runtime-core/memory-embedding-provider.ts";
import { createSiliconFlowEmbeddingProvider, hasSiliconFlowKey } from "./siliconflow-embedding-provider.ts";

export const LOCAL_QWEN_EMBEDDING = {
  id: "llama.cpp-qwen3-embedding-8b-q4_k_m", model: "qwen3-embedding-8b-q4_k_m", dimension: 4096,
  deployment: "local-llama.cpp", quantization: "Q4_K_M",
  source: "Qwen/Qwen3-Embedding-8B-GGUF", revision: "69d0e58a13e463cd99a9b83e3f5fee7c10265fab",
  weightsSha256: "3fcd3febec8b3fd64435204db75bf0dd73b91e8d0661e0331acfe7e7c3120b85",
} as const;

export function getLocomoEmbeddingConfig(env: NodeJS.ProcessEnv = process.env) {
  const local = env.RUNTIME_MEMORY_LOCAL_EMBEDDING_URL;
  if (!local) return {
    id: "siliconflow-qwen3-embed-8b", model: "Qwen/Qwen3-Embedding-8B", dimension: 4096,
    endpoint: "https://api.siliconflow.cn/v1/embeddings", deployment: "siliconflow", quantization: "provider-managed",
  };
  const base = new URL(local);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
    || base.username || base.password || base.search || base.hash) throw new Error("Local embedding endpoint must be credential-free loopback HTTP");
  base.pathname = base.pathname.replace(/\/$/, "") + "/embeddings";
  return { ...LOCAL_QWEN_EMBEDDING, endpoint: base.href };
}

export function hasLocomoEmbeddingConfig(): boolean {
  return Boolean(process.env.RUNTIME_MEMORY_LOCAL_EMBEDDING_URL) || hasSiliconFlowKey();
}

export async function verifyLocomoEmbeddingResources() {
  const config = getLocomoEmbeddingConfig();
  if (config.deployment === "siliconflow") {
    if (!hasSiliconFlowKey()) throw new Error("SILICONFLOW_API_KEY required unless an explicit verified local Qwen3 embedding deployment is provided");
    return config;
  }
  const file = process.env.RUNTIME_MEMORY_LOCAL_EMBEDDING_MODEL_FILE;
  if (!file) throw new Error("Local embedding model file is required for SHA256 verification");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const weightsSha256 = hash.digest("hex");
  if (weightsSha256 !== LOCAL_QWEN_EMBEDDING.weightsSha256) throw new Error("Local embedding model SHA256 mismatch");
  const response = await fetch(new URL("/props", config.endpoint), { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Local embedding server properties HTTP " + response.status); }
  const server = await response.json() as { model_path?: string; model_alias?: string; build_info?: string };
  if (server.model_alias !== config.model || typeof server.model_path !== "string"
    || typeof server.build_info !== "string" || !server.build_info
    || await realpath(server.model_path) !== await realpath(file)) throw new Error("Local embedding server is not serving the verified model file/alias");
  return { ...config, verifiedWeightsSha256: weightsSha256, serverBuild: server.build_info };
}

export function createLocomoEmbeddingProvider(): RuntimeEmbeddingProvider {
  const config = getLocomoEmbeddingConfig();
  if (config.deployment === "siliconflow") return createSiliconFlowEmbeddingProvider();
  const embed = async (texts: string[]): Promise<number[][]> => {
    if (!texts.length) return [];
    // No authorization header: provider keys must never leak to a local service.
    const response = await fetch(config.endpoint, {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, input: texts }), signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Local embedding HTTP " + response.status); }
    const body = await response.json() as { model?: string; data?: Array<{ index: number; embedding: number[] }> };
    if ((body.model !== config.model) || !Array.isArray(body.data) || body.data.length !== texts.length) throw new Error("Local embedding response model/count mismatch");
    const vectors = new Map<number, number[]>();
    for (const row of body.data) {
      if (!Number.isInteger(row.index) || row.index < 0 || row.index >= texts.length || vectors.has(row.index)
        || !Array.isArray(row.embedding) || row.embedding.length !== config.dimension
        || row.embedding.some(value => typeof value !== "number" || !Number.isFinite(value))
        || !row.embedding.some(value => value !== 0)) throw new Error("Invalid local embedding vector/index");
      vectors.set(row.index, row.embedding);
    }
    return texts.map((_, index) => vectors.get(index)!);
  };
  return {
    id: config.id, dimension: config.dimension,
    embedQuery: async text => (await embed([text]))[0],
    embedBatch: async texts => {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += 8) vectors.push(...await embed(texts.slice(start, start + 8)));
      return vectors;
    },
  };
}
