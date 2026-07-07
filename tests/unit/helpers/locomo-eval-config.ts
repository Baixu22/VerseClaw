// WP-E1: 评测配置集中化.
//
// Source: 500q 评测代码优化 (WP-E1)
//
// 设计目标:
//   - 20+ env vars 统一为 LocomoEvalConfig, 单一读取入口
//   - 兼容现有 env vars (不破坏基线)
//   - 支持 MemoryRuntimeConfig 注入 (Week 7-8 feature flags, 默认关闭)
//   - cache paths 集中管理
//   - cost 估算参数化 (不再硬编码在函数里)
//
// 约束:
//   - loadLocomoEvalConfig() 的默认值必须与重构前代码完全一致
//   - 不引入新依赖
//   - 配置对象 frozen, 运行期不可变

import { join } from "node:path";
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  createMemoryRuntimeConfig,
  type MemoryRuntimeConfig,
} from "../../../openclaw_runtime/src/runtime-core/memory-runtime-config.js";

// === Schema ===

/**
 * 评测运行模式.
 * - "default": 默认 dev-slice 模式 (使用缓存的 retrieval, 跳过 extraction/index)
 * - "full": FULL_EVAL=1, 跑全量 500q
 * - "smoke": SMOKE=1, 跑少量题 (默认 5/类 = 20q)
 */
export type LocomoEvalMode = "default" | "full" | "smoke";

/**
 * 集中化的评测配置.
 *
 * 替代散落在 500q 测试文件各处的 20+ process.env 读取.
 * 通过 loadLocomoEvalConfig() 从 env 加载, 也可通过 createLocomoEvalConfig() 手动构造.
 */
export type LocomoEvalConfig = {
  // === 运行模式 ===
  mode: LocomoEvalMode;
  /** smoke 模式下每类题数 (默认 5) */
  smokeSamplePerCategory: number;

  // === Model ===
  /** DeepSeek 模型名 (extraction / generation / judge 共用) */
  deepseekModel: string;

  // === Pipeline 阶段开关 (与原 env vars 一一对应, 默认值不变) ===
  /** buffered extraction (DISABLE_BUFFERED_EXTRACTION=1 关闭) */
  bufferedExtraction: boolean;
  /** extraction consolidation (DISABLE_CONSOLIDATION=1 关闭) */
  consolidation: boolean;
  /** AUDN 冲突解决 (ENABLE_AUDN_CURATION=1 开启, 默认关) */
  audnCuration: boolean;
  /** observation 跨 session 合并 (DISABLE_OBSERVATION_CONSOLIDATION=1 关闭) */
  observationConsolidation: boolean;
  /** entity store + boost (DISABLE_ENTITY_STORE=1 关闭) */
  entityStore: boolean;
  /** cross-encoder rerank (DISABLE_CROSS_ENCODER=1 关闭) */
  crossEncoder: boolean;
  /** episodic memory (DISABLE_EPISODIC_MEMORY / DISABLE_EPISODIC=1 关闭) */
  episodicMemory: boolean;
  /** weighted graph traversal (需 ENABLE_WEIGHTED_GRAPH=1 且 DISABLE_WEIGHTED_GRAPH!=1, 默认关) */
  weightedGraph: boolean;
  /** chained retrieval expand (DISABLE_CHAINED_RETRIEVAL=1 关闭) */
  chainedRetrieval: boolean;
  /** reflect agent (ENABLE_REFLECT_AGENT=1 开启, 默认关) */
  reflectAgent: boolean;
  /** judge cache (DISABLE_JUDGE_CACHE=1 关闭) */
  judgeCache: boolean;

  // === Multi-hop 策略 ===
  /** P3_MULTIHOP, 默认 "sequential-self-ask" */
  p3Multihop: string;
  /** P3_RERANKER, "cross-encoder" (默认) 或 "none" */
  p3Reranker: "cross-encoder" | "none";

  // === Cache paths ===
  factsCachePath: string;
  devSliceCachePath: string;
  sessionSummaryCachePath: string;
  observationCachePath: string;
  judgeCachePath: string;
  selfAskCachePath: string;
  /** 最终报告输出路径 */
  reportPath: string;
  /** artifacts 根目录 */
  artifactDir: string;

  // === Cost 估算 ===
  /** DeepSeek input 价格 (USD per million tokens) */
  deepseekInputPerMillion: number;
  /** DeepSeek output 价格 (USD per million tokens) */
  deepseekOutputPerMillion: number;

  // === Sample ===
  /** 全量模式 stratified sample seed (默认 42) */
  sampleSeed: number;
  /** 全量模式各类样本量 */
  sampleSizes: Record<string, number>;

  // === Week 7-8: Memory runtime config (feature flags, 默认全关) ===
  memoryRuntime: MemoryRuntimeConfig;
};

// === 默认值 (与重构前代码完全一致) ===

const ARTIFACT_DIR = join(process.cwd(), "artifacts", "runtime-memory-eval");

/**
 * 默认 sample sizes (全量模式).
 * multi_hop=96 (全量), temporal=150, single_hop=127, open_domain=127 = 500.
 */
export const DEFAULT_SAMPLE_SIZES: Record<string, number> = {
  multi_hop: 96,
  temporal: 150,
  single_hop: 127,
  open_domain: 127,
};

/** 默认 sample seed (P0-G: 固定 seed 消除采样方差) */
export const DEFAULT_SAMPLE_SEED = 42;

/** 默认 DeepSeek 价格 (USD per million tokens, conservative) */
export const DEFAULT_DEEPSEEK_INPUT_PER_MILLION = 0.27;
export const DEFAULT_DEEPSEEK_OUTPUT_PER_MILLION = 1.1;

/**
 * 默认 cache 文件名 (与重构前路径完全一致).
 */
export const DEFAULT_CACHE_FILES = {
  facts: "extracted-facts-cache-v6-additive-p0.json",
  devSlice: "dev-slice-cache.json",
  sessionSummary: "session-summary-cache.json",
  observation: "observations-cache.json",
  judge: "judge-result-cache.json",
  selfAsk: "self-ask-cache.json",
  report: "locomo-full-500-report.json",
} as const;

// === Env 读取工具 ===

function readString(env: NodeJS.ProcessEnv, key: string, defaultValue: string): string {
  const raw = env[key];
  return raw !== undefined && raw.length > 0 ? raw : defaultValue;
}

function readInt(env: NodeJS.ProcessEnv, key: string, defaultValue: number): number {
  const raw = env[key];
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

// === 加载函数 ===

/**
 * 从 process.env 加载评测配置.
 *
 * 语义与重构前散落的 process.env 读取完全一致:
 *   - DISABLE_*  默认 true (启用), =1 时 false
 *   - ENABLE_*   默认 false (关闭), =1 时 true
 *   - weightedGraph 需 ENABLE_WEIGHTED_GRAPH=1 且 DISABLE_WEIGHTED_GRAPH!=1
 *
 * Week 7-8 feature flags 通过 memoryRuntime 注入, 默认全关 (不破坏基线).
 * 可通过 MEMORY_RUNTIME_FEATURE_FLAGS env 传入 JSON 覆盖 (A/B 用).
 */
export function loadLocomoEvalConfig(
  env: NodeJS.ProcessEnv = process.env,
): LocomoEvalConfig {
  // === 模式 ===
  const fullEval = env.FULL_EVAL === "1" || process.argv.includes("--full");
  const smoke = env.SMOKE === "1" || process.argv.includes("--smoke");
  const mode: LocomoEvalMode = fullEval ? "full" : smoke ? "smoke" : "default";

  // === Model ===
  const deepseekModel = readString(env, "DEEPSEEK_MODEL", "deepseek-chat");

  // === Pipeline 阶段开关 ===
  const bufferedExtraction = env.DISABLE_BUFFERED_EXTRACTION !== "1";
  const consolidation = env.DISABLE_CONSOLIDATION !== "1";
  const audnCuration = env.ENABLE_AUDN_CURATION === "1";
  const observationConsolidation = env.DISABLE_OBSERVATION_CONSOLIDATION !== "1";
  const entityStore = env.DISABLE_ENTITY_STORE !== "1";
  const crossEncoder = env.DISABLE_CROSS_ENCODER !== "1";
  const episodicMemory =
    env.DISABLE_EPISODIC_MEMORY !== "1" && env.DISABLE_EPISODIC !== "1";
  // weightedGraph: 需同时满足 ENABLE=1 且 DISABLE!=1 (与原代码 line 2797-2798 一致)
  const weightedGraph =
    env.DISABLE_WEIGHTED_GRAPH !== "1" && env.ENABLE_WEIGHTED_GRAPH === "1";
  const chainedRetrieval = env.DISABLE_CHAINED_RETRIEVAL !== "1";
  const reflectAgent = env.ENABLE_REFLECT_AGENT === "1";
  const judgeCache = env.DISABLE_JUDGE_CACHE !== "1";

  // === Multi-hop 策略 ===
  const p3Multihop = readString(env, "P3_MULTIHOP", "sequential-self-ask");
  const p3RerankerRaw = readString(env, "P3_RERANKER", "cross-encoder");
  const p3Reranker: "cross-encoder" | "none" =
    p3RerankerRaw === "none" ? "none" : "cross-encoder";

  // === Smoke ===
  const smokeSamplePerCategory = readInt(env, "SMOKE_SAMPLE_PER_CATEGORY", 5);

  // === Week 7-8: MemoryRuntimeConfig ===
  // 默认全关. 两种启用方式:
  //
  // 1. 单个 env var (便捷, 推荐用于命令行):
  //    ENABLE_ENTITY_RESOLVER_IN_BRIDGE=1
  //    ENABLE_WEIGHTED_TRAVERSAL_IN_EXPANSION=1
  //    ENABLE_EVIDENCE_DISCIPLINE=1
  //    MEMORY_RUNTIME_HASH_ALG=sha256
  //
  // 2. JSON env var (灵活, 推荐用于 A/B 测试脚本):
  //    MEMORY_RUNTIME_FEATURE_FLAGS='{"enableEvidenceDiscipline":true,"enableEntityResolverInBridge":true}'
  //
  // 两种方式可同时使用: JSON 字段优先, 单个 env var 填充剩余字段.
  // 任一方式解析失败都回退到默认配置 (不破坏基线).
  const individualFlags: Partial<MemoryRuntimeConfig["featureFlags"]> = {};
  if (env.ENABLE_ENTITY_RESOLVER_IN_BRIDGE === "1") {
    individualFlags.enableEntityResolverInBridge = true;
  }
  if (env.ENABLE_WEIGHTED_TRAVERSAL_IN_EXPANSION === "1") {
    individualFlags.enableWeightedTraversalInExpansion = true;
  }
  if (env.ENABLE_EVIDENCE_DISCIPLINE === "1") {
    individualFlags.enableEvidenceDiscipline = true;
  }
  const hashAlg = env.MEMORY_RUNTIME_HASH_ALG as "djb2" | "sha256" | undefined;

  let memoryRuntime: MemoryRuntimeConfig = DEFAULT_MEMORY_RUNTIME_CONFIG;
  const flagsJson = env.MEMORY_RUNTIME_FEATURE_FLAGS;
  let jsonFlags: Partial<MemoryRuntimeConfig["featureFlags"]> | undefined;
  if (flagsJson) {
    try {
      jsonFlags = JSON.parse(flagsJson) as Partial<MemoryRuntimeConfig["featureFlags"]>;
    } catch {
      // JSON parse 失败, 用默认配置 + 单个 env var (不破坏基线)
    }
  }
  // 合并: 单个 env var + JSON (JSON 优先)
  const mergedFlags: Partial<MemoryRuntimeConfig["featureFlags"]> = {
    ...individualFlags,
    ...(jsonFlags ?? {}),
  };
  // 仅在有非默认值时才创建自定义配置 (否则保持 DEFAULT_MEMORY_RUNTIME_CONFIG)
  if (
    Object.keys(mergedFlags).length > 0 ||
    hashAlg !== undefined
  ) {
    memoryRuntime = createMemoryRuntimeConfig({
      featureFlags: mergedFlags,
      eventLogHashAlg: hashAlg,
    });
  }

  return {
    mode,
    smokeSamplePerCategory,
    deepseekModel,
    bufferedExtraction,
    consolidation,
    audnCuration,
    observationConsolidation,
    entityStore,
    crossEncoder,
    episodicMemory,
    weightedGraph,
    chainedRetrieval,
    reflectAgent,
    judgeCache,
    p3Multihop,
    p3Reranker,
    factsCachePath: join(ARTIFACT_DIR, DEFAULT_CACHE_FILES.facts),
    devSliceCachePath: join(ARTIFACT_DIR, DEFAULT_CACHE_FILES.devSlice),
    sessionSummaryCachePath: join(ARTIFACT_DIR, DEFAULT_CACHE_FILES.sessionSummary),
    observationCachePath: join(ARTIFACT_DIR, DEFAULT_CACHE_FILES.observation),
    judgeCachePath: join(ARTIFACT_DIR, DEFAULT_CACHE_FILES.judge),
    selfAskCachePath: join(ARTIFACT_DIR, DEFAULT_CACHE_FILES.selfAsk),
    reportPath: join(ARTIFACT_DIR, DEFAULT_CACHE_FILES.report),
    artifactDir: ARTIFACT_DIR,
    deepseekInputPerMillion: DEFAULT_DEEPSEEK_INPUT_PER_MILLION,
    deepseekOutputPerMillion: DEFAULT_DEEPSEEK_OUTPUT_PER_MILLION,
    sampleSeed: DEFAULT_SAMPLE_SEED,
    sampleSizes: { ...DEFAULT_SAMPLE_SIZES },
    memoryRuntime,
  };
}

// === 便捷工具 ===

/**
 * 手动构造配置 (测试用).
 *
 * 用法:
 *   const config = createLocomoEvalConfig({ deepseekModel: "test-model" });
 */
export function createLocomoEvalConfig(
  override: Partial<LocomoEvalConfig> = {},
): LocomoEvalConfig {
  const base = loadLocomoEvalConfig();
  return Object.freeze({ ...base, ...override });
}

/**
 * 获取 smoke 模式的 sample sizes.
 */
export function getSmokeSampleSizes(perCategory: number): Record<string, number> {
  return {
    single_hop: perCategory,
    temporal: perCategory,
    multi_hop: perCategory,
    open_domain: perCategory,
  };
}

/**
 * 根据模式获取实际 sample sizes.
 */
export function getActiveSampleSizes(config: LocomoEvalConfig): Record<string, number> {
  if (config.mode === "smoke") {
    return getSmokeSampleSizes(config.smokeSamplePerCategory);
  }
  return config.sampleSizes;
}

/**
 * 根据模式获取实际 sample seed.
 * (smoke/dev-slice 模式用 DEV_SLICE_SAMPLE_SEED, full 模式用 config.sampleSeed)
 */
export function getActiveSampleSeed(
  config: LocomoEvalConfig,
  devSliceSeed: number,
): number {
  return config.mode === "full" ? config.sampleSeed : devSliceSeed;
}

/**
 * DeepSeek cost 估算 (从 config 读价格, 替代硬编码).
 */
export function estimateDeepSeekCost(
  promptTokens: number,
  completionTokens: number,
  config: LocomoEvalConfig,
): number {
  return (
    (promptTokens / 1_000_000) * config.deepseekInputPerMillion +
    (completionTokens / 1_000_000) * config.deepseekOutputPerMillion
  );
}
