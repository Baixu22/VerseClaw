// WP-E3: Judge registry — 统一 judge strategy 接口 + A/B 切换.
//
// Source: 500q 评测代码优化 (WP-E3)
//
// 设计目标:
//   - judge-freeze (frozen-v2-generous) 和 unified-judge (unified-v2-generous) 注册为 strategy
//   - 支持 A/B 切换 (通过 config 或 env 选择 strategy)
//   - prompt 版本化, 每个 strategy 有唯一 promptVersion
//   - 默认 frozen-v2-generous (与现有 500q active judge 完全一致, 不破坏基线)
//
// 约束:
//   - 不修改现有 judge-freeze.ts / unified-judge.ts (它们保持原样, registry 只是 wrapper)
//   - JudgeStrategy.judge() 返回 { score: 0|1, ... } 与现有 judgeAnswer() 一致
//   - 不引入新依赖

import {
  FROZEN_JUDGE_CONFIG,
  buildFrozenJudgePrompt,
  parseFrozenJudgeVerdict,
} from "./runtime-memory-judge-freeze.js";
import {
  UNIFIED_JUDGE_CONFIG,
  judgeWithUnifiedPrompt,
  type JudgeResult as UnifiedJudgeResult,
  type JudgeCategory,
} from "./unified-judge.js";

// === Schema ===

/**
 * Judge strategy 标识符.
 * - "frozen-v2-generous": 现有 active judge (9 rules, single call, temp=0, maxTokens=8)
 * - "unified-v2-generous": 现有 diagnostic judge (7+ rules, voting 3 票, category-specific)
 * - "custom": 用户自定义 (通过 registerJudgeStrategy 注册)
 */
export type JudgeStrategyId = string;

/**
 * Judge 调用结果 (与现有 judgeAnswer 返回值兼容).
 */
export type JudgeVerdict = {
  /** 0 = WRONG, 1 = CORRECT */
  score: 0 | 1;
  /** strategy 标识符 (用于 trace) */
  strategyId: JudgeStrategyId;
  /** prompt 版本 (用于 cache key 和 trace) */
  promptVersion: string;
  /** 使用的模型 */
  model: string;
  /** 是否使用了投票 (unified-judge 才有) */
  votingUsed?: boolean;
  /** 投票明细 (votingUsed=true 时) */
  voteBreakdown?: { correct: number; wrong: number };
  /** judge confidence (unified-judge 才有, 0-1) */
  confidence?: number;
  /** category (unified-judge 才有) */
  category?: JudgeCategory;
};

/**
 * Judge strategy 接口.
 *
 * 每个注册的 strategy 实现此接口.
 * 调用方通过 judgeWithStrategy() 统一调用, 不直接接触具体 judge 实现.
 */
export type JudgeStrategy = {
  /** strategy 标识符 */
  readonly id: JudgeStrategyId;
  /** prompt 版本 (用于 cache key) */
  readonly promptVersion: string;
  /** 使用的模型 */
  readonly model: string;
  /**
   * 执行 judge.
   *
   * @param question 问题
   * @param groundTruth 标准答案
   * @param predictedAnswer 模型预测答案
   * @param options 可选: category (unified-judge 用), callDeepSeek (注入 LLM 调用)
   * @returns judge verdict
   */
  judge: (
    question: string,
    groundTruth: string | number,
    predictedAnswer: string,
    options?: JudgeCallOptions,
  ) => Promise<JudgeVerdict>;
};

/**
 * Judge 调用选项.
 */
export type JudgeCallOptions = {
  /** 问题类别 (unified-judge 用于 category-specific prompt) */
  category?: JudgeCategory;
  /**
   * 注入的 LLM 调用函数 (用于 mock 或共享 callTrackedDeepSeek).
   * 不传则 strategy 内部用自己的 callDeepSeek.
   */
  callLLM?: (
    system: string,
    user: string,
    options?: { temperature?: number; maxTokens?: number; model?: string },
  ) => Promise<{ content: string }>;
};

// === 内置 strategy 实现 ===

/**
 * frozen-v2-generous strategy (默认, 与现有 500q active judge 完全一致).
 *
 * - 9 generous rules, single call, temp=0, maxTokens=8
 * - promptVersion: "frozen-v2-generous-2026-07-04"
 * - 不参考 category, 不参考 evidence
 */
export const frozenJudgeStrategy: JudgeStrategy = {
  id: "frozen-v2-generous",
  promptVersion: FROZEN_JUDGE_CONFIG.promptVersion,
  model: FROZEN_JUDGE_CONFIG.model,

  async judge(
    question: string,
    groundTruth: string | number,
    predictedAnswer: string,
    options?: JudgeCallOptions,
  ): Promise<JudgeVerdict> {
    const { system, user } = buildFrozenJudgePrompt(
      question,
      groundTruth,
      predictedAnswer,
    );

    let content: string;
    if (options?.callLLM) {
      const response = await options.callLLM(system, user, {
        temperature: FROZEN_JUDGE_CONFIG.temperature,
        maxTokens: 8,
        model: FROZEN_JUDGE_CONFIG.model,
      });
      content = response.content;
    } else {
      // 不注入 callLLM 时, 直接用 buildFrozenJudgePrompt + parseFrozenJudgeVerdict
      // (调用方负责实际 LLM 调用, 这里只做 prompt 构建 + parse)
      // 这种模式用于 500q 测试文件里已有的 judgeAnswer() 函数
      throw new Error(
        "frozenJudgeStrategy.judge() requires options.callLLM when used standalone. " +
          "In 500q test, use the existing judgeAnswer() wrapper which injects callTrackedDeepSeek.",
      );
    }

    const score = parseFrozenJudgeVerdict(content) as 0 | 1;
    return {
      score,
      strategyId: "frozen-v2-generous",
      promptVersion: FROZEN_JUDGE_CONFIG.promptVersion,
      model: FROZEN_JUDGE_CONFIG.model,
    };
  },
};

/**
 * unified-v2-generous strategy (diagnostic, voting 3 票).
 *
 * - 7+ generous rules, voting (3 calls, temp=0.3), category-specific prompt
 * - promptVersion: "unified-v2-generous-7rules-2026-07-05"
 * - 参考 category (temporal/multi_hop/single_hop/open_domain 有不同扩展规则)
 *
 * 注意: 此 strategy 调用 judgeWithUnifiedPrompt, 后者内部用 callDeepSeek.
 * 若需 mock, 通过 options.callLLM 注入 (但 judgeWithUnifiedPrompt 不支持 callLLM 注入,
 * 所以 unified strategy 的 mock 需要在 unified-judge.ts 层面做).
 */
export const unifiedJudgeStrategy: JudgeStrategy = {
  id: "unified-v2-generous",
  promptVersion: UNIFIED_JUDGE_CONFIG.promptVersion,
  model: UNIFIED_JUDGE_CONFIG.model,

  async judge(
    question: string,
    groundTruth: string | number,
    predictedAnswer: string,
    options?: JudgeCallOptions,
  ): Promise<JudgeVerdict> {
    // judgeWithUnifiedPrompt 内部调用 callDeepSeek (不支持 callLLM 注入)
    // 若需 A/B mock, 应在 callDeepSeek 层面 mock
    const result: UnifiedJudgeResult = await judgeWithUnifiedPrompt(
      question,
      String(groundTruth),
      predictedAnswer,
      options?.category ?? "single_hop",
    );

    return {
      score: result.verdict === "CORRECT" ? 1 : 0,
      strategyId: "unified-v2-generous",
      promptVersion: UNIFIED_JUDGE_CONFIG.promptVersion,
      model: UNIFIED_JUDGE_CONFIG.model,
      votingUsed: UNIFIED_JUDGE_CONFIG.votingEnabled,
      ...(result.voteBreakdown
        ? { voteBreakdown: result.voteBreakdown }
        : {}),
      confidence: result.confidence,
      category: options?.category,
    };
  },
};

// === Registry ===

const strategyRegistry = new Map<JudgeStrategyId, JudgeStrategy>();

// 注册内置 strategy
strategyRegistry.set("frozen-v2-generous", frozenJudgeStrategy);
strategyRegistry.set("unified-v2-generous", unifiedJudgeStrategy);

/**
 * 注册自定义 judge strategy.
 *
 * 用法:
 *   registerJudgeStrategy("my-custom-judge", { id: "my-custom-judge", ... });
 */
export function registerJudgeStrategy(id: JudgeStrategyId, strategy: JudgeStrategy): void {
  strategyRegistry.set(id, strategy);
}

/**
 * 获取已注册的 strategy.
 *
 * @param id strategy 标识符
 * @returns strategy (未找到则 throw)
 */
export function getJudgeStrategy(id: JudgeStrategyId): JudgeStrategy {
  const strategy = strategyRegistry.get(id);
  if (!strategy) {
    throw new Error(
      `Judge strategy "${id}" not registered. Available: ${[...strategyRegistry.keys()].join(", ")}`,
    );
  }
  return strategy;
}

/**
 * 列出所有已注册的 strategy ID.
 */
export function listJudgeStrategies(): JudgeStrategyId[] {
  return [...strategyRegistry.keys()];
}

/**
 * 默认 strategy ID (与现有 500q active judge 一致).
 */
export const DEFAULT_JUDGE_STRATEGY_ID: JudgeStrategyId = "frozen-v2-generous";

/**
 * 从 env 读取 judge strategy ID (用于 A/B 切换).
 *
 * - JUDGE_STRATEGY=frozen-v2-generous (默认)
 * - JUDGE_STRATEGY=unified-v2-generous (diagnostic)
 * - JUDGE_STRATEGY=<custom-id> (需先 registerJudgeStrategy)
 */
export function getJudgeStrategyIdFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): JudgeStrategyId {
  return env.JUDGE_STRATEGY ?? DEFAULT_JUDGE_STRATEGY_ID;
}

// === 统一调用入口 ===

/**
 * 用指定 strategy 执行 judge.
 *
 * 用法:
 *   const verdict = await judgeWithStrategy(
 *     "frozen-v2-generous",
 *     question, groundTruth, predictedAnswer,
 *     { callLLM: callTrackedDeepSeek },
 *   );
 *   judgeScore = verdict.score;
 *
 * 或从 env 读 strategy:
 *   const strategyId = getJudgeStrategyIdFromEnv();
 *   const verdict = await judgeWithStrategy(strategyId, ...);
 */
export async function judgeWithStrategy(
  strategyId: JudgeStrategyId,
  question: string,
  groundTruth: string | number,
  predictedAnswer: string,
  options?: JudgeCallOptions,
): Promise<JudgeVerdict> {
  const strategy = getJudgeStrategy(strategyId);
  return strategy.judge(question, groundTruth, predictedAnswer, options);
}

/**
 * 用默认 strategy (frozen-v2-generous) 执行 judge.
 *
 * 便捷函数, 等价于 judgeWithStrategy(DEFAULT_JUDGE_STRATEGY_ID, ...).
 */
export async function judgeWithDefaultStrategy(
  question: string,
  groundTruth: string | number,
  predictedAnswer: string,
  options?: JudgeCallOptions,
): Promise<JudgeVerdict> {
  return judgeWithStrategy(
    DEFAULT_JUDGE_STRATEGY_ID,
    question,
    groundTruth,
    predictedAnswer,
    options,
  );
}

// === Judge cache key 工具 ===

/**
 * 构建 judge cache key (与 judge-result-cache.ts 的 key 语义一致).
 *
 * key = strategyId + promptVersion + judgeModel + question + groundTruth + predictedAnswer
 *
 * strategy 切换或 promptVersion 变更 → key 变更 → cache miss (A/B 隔离).
 */
export function buildJudgeCacheKey(
  strategyId: JudgeStrategyId,
  promptVersion: string,
  judgeModel: string,
  question: string,
  groundTruth: string | number,
  predictedAnswer: string,
): string {
  return `${strategyId}\u0000${promptVersion}\u0000${judgeModel}\u0000${question}\u0000${groundTruth}\u0000${predictedAnswer}`;
}
