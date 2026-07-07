// @vitest-environment node
// WP-E3: Judge registry 单元测试.
//
// 覆盖:
// - 注册/获取/列出 strategy
// - 内置 strategy (frozen-v2-generous, unified-v2-generous) 存在且字段正确
// - 默认 strategy ID = frozen-v2-generous
// - env 读取 strategy ID (A/B 切换)
// - judge cache key 隔离 (strategy/promptVersion 变更 → key 变更)
// - frozenJudgeStrategy.judge() with mock callLLM (score 0/1)
// - judgeWithStrategy / judgeWithDefaultStrategy
// - 未注册 strategy throw
import { describe, expect, it } from "vitest";
import {
  frozenJudgeStrategy,
  unifiedJudgeStrategy,
  registerJudgeStrategy,
  getJudgeStrategy,
  listJudgeStrategies,
  DEFAULT_JUDGE_STRATEGY_ID,
  getJudgeStrategyIdFromEnv,
  judgeWithStrategy,
  judgeWithDefaultStrategy,
  buildJudgeCacheKey,
  type JudgeStrategy,
  type JudgeCallOptions,
} from "./helpers/locomo-judge-registry.js";
import { FROZEN_JUDGE_CONFIG } from "./helpers/runtime-memory-judge-freeze.js";
import { UNIFIED_JUDGE_CONFIG } from "./helpers/unified-judge.js";

const CLEAN_ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH };

describe("WP-E3: Judge registry — 注册/获取/列出", () => {
  it("should_have_frozen_and_unified_strategies_registered_by_default", () => {
    const ids = listJudgeStrategies();
    expect(ids).toContain("frozen-v2-generous");
    expect(ids).toContain("unified-v2-generous");
  });

  it("should_getJudgeStrategy_return_strategy_for_known_id", () => {
    const strategy = getJudgeStrategy("frozen-v2-generous");
    expect(strategy.id).toBe("frozen-v2-generous");
  });

  it("should_getJudgeStrategy_throw_for_unknown_id", () => {
    expect(() => getJudgeStrategy("nonexistent-judge")).toThrow(/not registered/);
  });

  it("should_registerJudgeStrategy_add_custom_strategy", () => {
    const custom: JudgeStrategy = {
      id: "test-custom-judge",
      promptVersion: "test-v1",
      model: "test-model",
      judge: async () => ({
        score: 1,
        strategyId: "test-custom-judge",
        promptVersion: "test-v1",
        model: "test-model",
      }),
    };
    registerJudgeStrategy("test-custom-judge", custom);
    expect(listJudgeStrategies()).toContain("test-custom-judge");
    expect(getJudgeStrategy("test-custom-judge").id).toBe("test-custom-judge");
  });
});

describe("WP-E3: 内置 strategy 字段", () => {
  it("should_frozen_strategy_match_FROZEN_JUDGE_CONFIG", () => {
    expect(frozenJudgeStrategy.id).toBe("frozen-v2-generous");
    expect(frozenJudgeStrategy.promptVersion).toBe(FROZEN_JUDGE_CONFIG.promptVersion);
    expect(frozenJudgeStrategy.model).toBe(FROZEN_JUDGE_CONFIG.model);
  });

  it("should_unified_strategy_match_UNIFIED_JUDGE_CONFIG", () => {
    expect(unifiedJudgeStrategy.id).toBe("unified-v2-generous");
    expect(unifiedJudgeStrategy.promptVersion).toBe(UNIFIED_JUDGE_CONFIG.promptVersion);
    expect(unifiedJudgeStrategy.model).toBe(UNIFIED_JUDGE_CONFIG.model);
  });

  it("should_frozen_and_unified_have_different_prompt_versions", () => {
    expect(frozenJudgeStrategy.promptVersion).not.toBe(unifiedJudgeStrategy.promptVersion);
  });
});

describe("WP-E3: 默认 strategy + env 读取", () => {
  it("should_DEFAULT_JUDGE_STRATEGY_ID_be_frozen_v2_generous", () => {
    expect(DEFAULT_JUDGE_STRATEGY_ID).toBe("frozen-v2-generous");
  });

  it("should_getJudgeStrategyIdFromEnv_default_when_no_env", () => {
    expect(getJudgeStrategyIdFromEnv(CLEAN_ENV)).toBe("frozen-v2-generous");
  });

  it("should_getJudgeStrategyIdFromEnv_read_JUDGE_STRATEGY", () => {
    expect(
      getJudgeStrategyIdFromEnv({ ...CLEAN_ENV, JUDGE_STRATEGY: "unified-v2-generous" }),
    ).toBe("unified-v2-generous");
  });

  it("should_getJudgeStrategyIdFromEnv_read_custom_strategy", () => {
    expect(
      getJudgeStrategyIdFromEnv({ ...CLEAN_ENV, JUDGE_STRATEGY: "my-experimental-judge" }),
    ).toBe("my-experimental-judge");
  });
});

describe("WP-E3: judge cache key 隔离", () => {
  const baseArgs = ["What is Jon's job?", "engineer", "He is an engineer"] as const;

  it("should_same_strategy_produce_same_key", () => {
    const key1 = buildJudgeCacheKey("frozen-v2-generous", "v1", "model", ...baseArgs);
    const key2 = buildJudgeCacheKey("frozen-v2-generous", "v1", "model", ...baseArgs);
    expect(key1).toBe(key2);
  });

  it("should_different_strategy_produce_different_key", () => {
    const key1 = buildJudgeCacheKey("frozen-v2-generous", "v1", "model", ...baseArgs);
    const key2 = buildJudgeCacheKey("unified-v2-generous", "v1", "model", ...baseArgs);
    expect(key1).not.toBe(key2);
  });

  it("should_different_promptVersion_produce_different_key", () => {
    const key1 = buildJudgeCacheKey("frozen-v2-generous", "v1", "model", ...baseArgs);
    const key2 = buildJudgeCacheKey("frozen-v2-generous", "v2", "model", ...baseArgs);
    expect(key1).not.toBe(key2);
  });

  it("should_different_model_produce_different_key", () => {
    const key1 = buildJudgeCacheKey("frozen-v2-generous", "v1", "model-a", ...baseArgs);
    const key2 = buildJudgeCacheKey("frozen-v2-generous", "v1", "model-b", ...baseArgs);
    expect(key1).not.toBe(key2);
  });

  it("should_different_question_produce_different_key", () => {
    const key1 = buildJudgeCacheKey("s", "v", "m", "Q1", "a", "pred");
    const key2 = buildJudgeCacheKey("s", "v", "m", "Q2", "a", "pred");
    expect(key1).not.toBe(key2);
  });
});

describe("WP-E3: frozenJudgeStrategy.judge() with mock", () => {
  it("should_return_score_1_when_judge_says_CORRECT", async () => {
    const mockCallLLM: JudgeCallOptions["callLLM"] = async () => ({
      content: "CORRECT",
    });
    const verdict = await frozenJudgeStrategy.judge(
      "What is Jon's job?",
      "engineer",
      "He is an engineer",
      { callLLM: mockCallLLM },
    );
    expect(verdict.score).toBe(1);
    expect(verdict.strategyId).toBe("frozen-v2-generous");
    expect(verdict.promptVersion).toBe(FROZEN_JUDGE_CONFIG.promptVersion);
    expect(verdict.model).toBe(FROZEN_JUDGE_CONFIG.model);
  });

  it("should_return_score_0_when_judge_says_WRONG", async () => {
    const mockCallLLM: JudgeCallOptions["callLLM"] = async () => ({
      content: "WRONG",
    });
    const verdict = await frozenJudgeStrategy.judge(
      "What is Jon's job?",
      "engineer",
      "He is a doctor",
      { callLLM: mockCallLLM },
    );
    expect(verdict.score).toBe(0);
  });

  it("should_return_score_1_when_judge_says_yes_legacy", async () => {
    // parseFrozenJudgeVerdict 接受 "yes" (legacy)
    const mockCallLLM: JudgeCallOptions["callLLM"] = async () => ({
      content: "yes",
    });
    const verdict = await frozenJudgeStrategy.judge("Q", "A", "A", {
      callLLM: mockCallLLM,
    });
    expect(verdict.score).toBe(1);
  });

  it("should_throw_when_callLLM_not_provided", async () => {
    await expect(
      frozenJudgeStrategy.judge("Q", "A", "A"),
    ).rejects.toThrow(/requires options.callLLM/);
  });
});

describe("WP-E3: judgeWithStrategy / judgeWithDefaultStrategy", () => {
  it("should_judgeWithStrategy_use_specified_strategy", async () => {
    const mockCallLLM: JudgeCallOptions["callLLM"] = async () => ({
      content: "CORRECT",
    });
    const verdict = await judgeWithStrategy(
      "frozen-v2-generous",
      "Q",
      "A",
      "A",
      { callLLM: mockCallLLM },
    );
    expect(verdict.score).toBe(1);
    expect(verdict.strategyId).toBe("frozen-v2-generous");
  });

  it("should_judgeWithDefaultStrategy_use_frozen_v2_generous", async () => {
    const mockCallLLM: JudgeCallOptions["callLLM"] = async () => ({
      content: "WRONG",
    });
    const verdict = await judgeWithDefaultStrategy("Q", "A", "B", {
      callLLM: mockCallLLM,
    });
    expect(verdict.score).toBe(0);
    expect(verdict.strategyId).toBe(DEFAULT_JUDGE_STRATEGY_ID);
  });

  it("should_judgeWithStrategy_throw_for_unknown_strategy", async () => {
    await expect(
      judgeWithStrategy("nonexistent", "Q", "A", "A"),
    ).rejects.toThrow(/not registered/);
  });
});
