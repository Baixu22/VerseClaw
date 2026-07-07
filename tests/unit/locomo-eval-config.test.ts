// @vitest-environment node
// WP-E1: 评测配置集中化单元测试.
//
// 覆盖:
// - 默认配置与原 env vars 语义一致 (不破坏基线)
// - DISABLE_* / ENABLE_* flag 正确解析
// - mode 三态 (default/full/smoke)
// - cache paths 集中化
// - cost 估算参数化
// - MemoryRuntimeConfig 注入 (Week 7-8 feature flags)
// - smoke sample sizes 工具
import { describe, expect, it } from "vitest";
import {
  loadLocomoEvalConfig,
  createLocomoEvalConfig,
  getSmokeSampleSizes,
  getActiveSampleSizes,
  getActiveSampleSeed,
  estimateDeepSeekCost,
  DEFAULT_SAMPLE_SIZES,
  DEFAULT_SAMPLE_SEED,
  DEFAULT_DEEPSEEK_INPUT_PER_MILLION,
  DEFAULT_DEEPSEEK_OUTPUT_PER_MILLION,
  DEFAULT_CACHE_FILES,
} from "./helpers/locomo-eval-config.js";

// 干净的 env (无任何评测相关 var)
const CLEAN_ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH };

describe("WP-E1: LocomoEvalConfig — 默认值与基线一致", () => {
  it("should_return_default_mode_when_no_env", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.mode).toBe("default");
  });

  it("should_return_full_mode_when_FULL_EVAL_1", () => {
    const config = loadLocomoEvalConfig({ ...CLEAN_ENV, FULL_EVAL: "1" });
    expect(config.mode).toBe("full");
  });

  it("should_return_smoke_mode_when_SMOKE_1", () => {
    const config = loadLocomoEvalConfig({ ...CLEAN_ENV, SMOKE: "1" });
    expect(config.mode).toBe("smoke");
  });

  it("should_full_mode_take_precedence_over_smoke", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      FULL_EVAL: "1",
      SMOKE: "1",
    });
    expect(config.mode).toBe("full");
  });

  it("should_default_deepseekModel_be_deepseek_chat", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.deepseekModel).toBe("deepseek-chat");
  });

  it("should_override_deepseekModel_from_env", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      DEEPSEEK_MODEL: "deepseek-v4-flash",
    });
    expect(config.deepseekModel).toBe("deepseek-v4-flash");
  });
});

describe("WP-E1: DISABLE_* / ENABLE_* flag 解析", () => {
  it("should_default_all_DISABLE_flags_be_true", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    // DISABLE_* 默认 true (启用功能)
    expect(config.bufferedExtraction).toBe(true);
    expect(config.consolidation).toBe(true);
    expect(config.observationConsolidation).toBe(true);
    expect(config.entityStore).toBe(true);
    expect(config.crossEncoder).toBe(true);
    expect(config.episodicMemory).toBe(true);
    expect(config.chainedRetrieval).toBe(true);
    expect(config.judgeCache).toBe(true);
  });

  it("should_default_all_ENABLE_flags_be_false", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    // ENABLE_* 默认 false (关闭功能)
    expect(config.audnCuration).toBe(false);
    expect(config.weightedGraph).toBe(false);
    expect(config.reflectAgent).toBe(false);
  });

  it("should_DISABLE_BUFFERED_EXTRACTION_1_set_false", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      DISABLE_BUFFERED_EXTRACTION: "1",
    });
    expect(config.bufferedExtraction).toBe(false);
  });

  it("should_ENABLE_AUDN_CURATION_1_set_true", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_AUDN_CURATION: "1",
    });
    expect(config.audnCuration).toBe(true);
  });

  it("should_weightedGraph_require_both_ENABLE_and_not_DISABLE", () => {
    // 只有 ENABLE, 没有 DISABLE → true
    expect(
      loadLocomoEvalConfig({
        ...CLEAN_ENV,
        ENABLE_WEIGHTED_GRAPH: "1",
      }).weightedGraph,
    ).toBe(true);

    // ENABLE + DISABLE → false
    expect(
      loadLocomoEvalConfig({
        ...CLEAN_ENV,
        ENABLE_WEIGHTED_GRAPH: "1",
        DISABLE_WEIGHTED_GRAPH: "1",
      }).weightedGraph,
    ).toBe(false);

    // 只有 DISABLE, 没有 ENABLE → false
    expect(
      loadLocomoEvalConfig({
        ...CLEAN_ENV,
        DISABLE_WEIGHTED_GRAPH: "0",
      }).weightedGraph,
    ).toBe(false);
  });

  it("should_episodicMemory_respond_to_both_DISABLE_EPISODIC_MEMORY_and_DISABLE_EPISODIC", () => {
    // DISABLE_EPISODIC_MEMORY=1
    expect(
      loadLocomoEvalConfig({
        ...CLEAN_ENV,
        DISABLE_EPISODIC_MEMORY: "1",
      }).episodicMemory,
    ).toBe(false);

    // DISABLE_EPISODIC=1 (legacy alias)
    expect(
      loadLocomoEvalConfig({
        ...CLEAN_ENV,
        DISABLE_EPISODIC: "1",
      }).episodicMemory,
    ).toBe(false);

    // 两者都不设 → true
    expect(loadLocomoEvalConfig(CLEAN_ENV).episodicMemory).toBe(true);
  });

  it("should_p3Multihop_default_sequential_self_ask", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.p3Multihop).toBe("sequential-self-ask");
  });

  it("should_p3Reranker_default_cross_encoder", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.p3Reranker).toBe("cross-encoder");
  });

  it("should_p3Reranker_none_when_env_sets_none", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      P3_RERANKER: "none",
    });
    expect(config.p3Reranker).toBe("none");
  });

  it("should_smokeSamplePerCategory_default_5", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.smokeSamplePerCategory).toBe(5);
  });

  it("should_smokeSamplePerCategory_override_from_env", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      SMOKE_SAMPLE_PER_CATEGORY: "3",
    });
    expect(config.smokeSamplePerCategory).toBe(3);
  });
});

describe("WP-E1: cache paths 集中化", () => {
  it("should_all_cache_paths_under_artifact_dir", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    // 用 normalize 后的路径检查 (Windows 用 \, POSIX 用 /)
    const normalize = (p: string) => p.replace(/\\/g, "/");
    expect(normalize(config.factsCachePath)).toContain("artifacts/runtime-memory-eval");
    expect(normalize(config.devSliceCachePath)).toContain("artifacts/runtime-memory-eval");
    expect(normalize(config.sessionSummaryCachePath)).toContain("artifacts/runtime-memory-eval");
    expect(normalize(config.observationCachePath)).toContain("artifacts/runtime-memory-eval");
    expect(normalize(config.judgeCachePath)).toContain("artifacts/runtime-memory-eval");
    expect(normalize(config.selfAskCachePath)).toContain("artifacts/runtime-memory-eval");
    expect(normalize(config.reportPath)).toContain("artifacts/runtime-memory-eval");
  });

  it("should_facts_cache_path_match_v6_additive_p0", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.factsCachePath).toContain(DEFAULT_CACHE_FILES.facts);
  });

  it("should_report_path_match_locomo_full_500_report", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.reportPath).toContain(DEFAULT_CACHE_FILES.report);
  });
});

describe("WP-E1: cost 估算参数化", () => {
  it("should_default_prices_match_hardcoded_values", () => {
    expect(DEFAULT_DEEPSEEK_INPUT_PER_MILLION).toBe(0.27);
    expect(DEFAULT_DEEPSEEK_OUTPUT_PER_MILLION).toBe(1.1);
  });

  it("should_estimateDeepSeekCost_use_config_prices", () => {
    const config = createLocomoEvalConfig({
      deepseekInputPerMillion: 0.27,
      deepseekOutputPerMillion: 1.1,
    });
    // 1M input + 0.5M output = 0.27 + 0.55 = 0.82
    const cost = estimateDeepSeekCost(1_000_000, 500_000, config);
    expect(cost).toBeCloseTo(0.82, 4);
  });

  it("should_estimateDeepSeekCost_zero_for_zero_tokens", () => {
    const config = createLocomoEvalConfig({});
    expect(estimateDeepSeekCost(0, 0, config)).toBe(0);
  });
});

describe("WP-E1: sample sizes 工具", () => {
  it("should_DEFAULT_SAMPLE_SIZES_sum_to_500", () => {
    const total = Object.values(DEFAULT_SAMPLE_SIZES).reduce((a, b) => a + b, 0);
    expect(total).toBe(500);
  });

  it("should_getSmokeSampleSizes_return_uniform_per_category", () => {
    const sizes = getSmokeSampleSizes(3);
    expect(sizes.single_hop).toBe(3);
    expect(sizes.temporal).toBe(3);
    expect(sizes.multi_hop).toBe(3);
    expect(sizes.open_domain).toBe(3);
  });

  it("should_getActiveSampleSizes_return_smoke_sizes_in_smoke_mode", () => {
    const config = createLocomoEvalConfig({
      mode: "smoke",
      smokeSamplePerCategory: 2,
    });
    const sizes = getActiveSampleSizes(config);
    expect(sizes.multi_hop).toBe(2);
  });

  it("should_getActiveSampleSizes_return_full_sizes_in_full_mode", () => {
    const config = createLocomoEvalConfig({ mode: "full" });
    const sizes = getActiveSampleSizes(config);
    expect(sizes.multi_hop).toBe(96);
    expect(sizes.temporal).toBe(150);
  });

  it("should_getActiveSampleSeed_use_sampleSeed_in_full_mode", () => {
    const config = createLocomoEvalConfig({ mode: "full" });
    expect(getActiveSampleSeed(config, 999)).toBe(DEFAULT_SAMPLE_SEED);
  });

  it("should_getActiveSampleSeed_use_devSliceSeed_in_non_full_mode", () => {
    const config = createLocomoEvalConfig({ mode: "default" });
    expect(getActiveSampleSeed(config, 999)).toBe(999);
  });
});

describe("WP-E1: MemoryRuntimeConfig 注入 (Week 7-8)", () => {
  it("should_default_memoryRuntime_have_all_flags_false", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(false);
    expect(config.memoryRuntime.featureFlags.enableWeightedTraversalInExpansion).toBe(false);
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(false);
    expect(config.memoryRuntime.eventLogHashAlg).toBe("sha256");
  });

  it("should_memoryRuntime_override_via_MEMORY_RUNTIME_FEATURE_FLAGS_env", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      MEMORY_RUNTIME_FEATURE_FLAGS: JSON.stringify({
        enableEntityResolverInBridge: true,
        enableEvidenceDiscipline: true,
      }),
    });
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(true);
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(true);
    // 未设置的 flag 保持默认 false
    expect(config.memoryRuntime.featureFlags.enableWeightedTraversalInExpansion).toBe(false);
  });

  it("should_memoryRuntime_invalid_JSON_fallback_to_default", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      MEMORY_RUNTIME_FEATURE_FLAGS: "not-valid-json",
    });
    // parse 失败, 用默认配置 (不破坏基线)
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(false);
  });

  it("should_memoryRuntime_hashAlg_override_via_env", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      MEMORY_RUNTIME_FEATURE_FLAGS: "{}",
      MEMORY_RUNTIME_HASH_ALG: "djb2",
    });
    expect(config.memoryRuntime.eventLogHashAlg).toBe("djb2");
  });
});

describe("WP-E5: MemoryRuntimeConfig 单个 env var 映射", () => {
  it("should_ENABLE_ENTITY_RESOLVER_IN_BRIDGE_1_set_flag", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_ENTITY_RESOLVER_IN_BRIDGE: "1",
    });
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(true);
    // 其他 flag 保持默认 false
    expect(config.memoryRuntime.featureFlags.enableWeightedTraversalInExpansion).toBe(false);
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(false);
  });

  it("should_ENABLE_WEIGHTED_TRAVERSAL_IN_EXPANSION_1_set_flag", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_WEIGHTED_TRAVERSAL_IN_EXPANSION: "1",
    });
    expect(config.memoryRuntime.featureFlags.enableWeightedTraversalInExpansion).toBe(true);
  });

  it("should_ENABLE_EVIDENCE_DISCIPLINE_1_set_flag", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_EVIDENCE_DISCIPLINE: "1",
    });
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(true);
  });

  it("should_MEMORY_RUNTIME_HASH_ALG_without_JSON_set_hashAlg", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      MEMORY_RUNTIME_HASH_ALG: "djb2",
    });
    expect(config.memoryRuntime.eventLogHashAlg).toBe("djb2");
  });

  it("should_multiple_individual_env_vars_combined", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_ENTITY_RESOLVER_IN_BRIDGE: "1",
      ENABLE_WEIGHTED_TRAVERSAL_IN_EXPANSION: "1",
      ENABLE_EVIDENCE_DISCIPLINE: "1",
      MEMORY_RUNTIME_HASH_ALG: "sha256",
    });
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(true);
    expect(config.memoryRuntime.featureFlags.enableWeightedTraversalInExpansion).toBe(true);
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(true);
    expect(config.memoryRuntime.eventLogHashAlg).toBe("sha256");
  });

  it("should_individual_env_var_0_not_set_flag", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_EVIDENCE_DISCIPLINE: "0",
    });
    // "0" !== "1" → flag 保持 false
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(false);
  });

  it("should_individual_env_var_other_value_not_set_flag", () => {
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_EVIDENCE_DISCIPLINE: "true", // 非 "1"
    });
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(false);
  });

  it("should_JSON_take_precedence_over_individual_env_var", () => {
    // individual=true, JSON=false → JSON 优先, 最终为 false
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_EVIDENCE_DISCIPLINE: "1",
      MEMORY_RUNTIME_FEATURE_FLAGS: JSON.stringify({
        enableEvidenceDiscipline: false,
      }),
    });
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(false);
  });

  it("should_individual_env_var_fill_fields_not_in_JSON", () => {
    // JSON 只设 enableEntityResolverInBridge, individual 设 enableEvidenceDiscipline
    // 两者合并: 两个都为 true
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_EVIDENCE_DISCIPLINE: "1",
      MEMORY_RUNTIME_FEATURE_FLAGS: JSON.stringify({
        enableEntityResolverInBridge: true,
      }),
    });
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(true);
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(true);
  });

  it("should_no_individual_env_var_and_no_JSON_use_default_config", () => {
    const config = loadLocomoEvalConfig(CLEAN_ENV);
    // 默认全关
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(false);
    expect(config.memoryRuntime.featureFlags.enableWeightedTraversalInExpansion).toBe(false);
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(false);
    // eventLogHashAlg 默认 sha256 (来自 DEFAULT_MEMORY_RUNTIME_CONFIG)
    expect(config.memoryRuntime.eventLogHashAlg).toBe("sha256");
  });

  it("should_invalid_JSON_with_individual_env_var_still_apply_individual", () => {
    // JSON parse 失败, 但 individual env var 仍应生效
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_EVIDENCE_DISCIPLINE: "1",
      MEMORY_RUNTIME_FEATURE_FLAGS: "not-valid-json",
    });
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(true);
  });

  it("should_invalid_JSON_fallback_does_not_break_individual_flags", () => {
    // JSON 无效, 多个 individual env var 仍应生效
    const config = loadLocomoEvalConfig({
      ...CLEAN_ENV,
      ENABLE_ENTITY_RESOLVER_IN_BRIDGE: "1",
      ENABLE_WEIGHTED_TRAVERSAL_IN_EXPANSION: "1",
      ENABLE_EVIDENCE_DISCIPLINE: "1",
      MEMORY_RUNTIME_FEATURE_FLAGS: "{invalid",
    });
    expect(config.memoryRuntime.featureFlags.enableEntityResolverInBridge).toBe(true);
    expect(config.memoryRuntime.featureFlags.enableWeightedTraversalInExpansion).toBe(true);
    expect(config.memoryRuntime.featureFlags.enableEvidenceDiscipline).toBe(true);
  });
});

describe("WP-E1: createLocomoEvalConfig 便捷构造", () => {
  it("should_createLocomoEvalConfig_override_specific_fields", () => {
    const config = createLocomoEvalConfig({
      deepseekModel: "test-model",
      mode: "smoke",
    });
    expect(config.deepseekModel).toBe("test-model");
    expect(config.mode).toBe("smoke");
    // 未 override 的字段保持默认
    expect(config.bufferedExtraction).toBe(true);
  });

  it("should_createLocomoEvalConfig_return_frozen_object", () => {
    const config = createLocomoEvalConfig({});
    expect(Object.isFrozen(config)).toBe(true);
  });
});
