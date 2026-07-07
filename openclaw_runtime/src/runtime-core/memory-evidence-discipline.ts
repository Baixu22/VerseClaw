// Week 7-8 WP4: Evidence discipline (生成端证据纪律).
//
// Source: Week 7-8 DEV PROMPT WP4
//
// 设计目标:
//   - 减少"生成端忽略证据/编造" (hallucination)
//   - 答案必须可追溯到 recalled facts/observations
//   - 不靠长 prompt, 用结构化输出 + runtime 校验
//
// 工作流:
//   1. 模型输出必须包含 usedFactIds[] (JSON 输出或 FACT_IDS: 尾注 parse)
//   2. runtime 校验: usedFactIds ⊆ recalledFacts ∪ supportFactIdsExpanded
//   3. 不满足且 enableEvidenceDiscipline=true:
//      - 降级策略 A: 返回 "INSUFFICIENT_EVIDENCE"
//      - 降级策略 B: 强制重新生成一次 (受 budget 限制)
//   4. 证据纪律写入 trace: evidenceDiscipline {enabled, usedFactIds, validated, ...}
//
// 由 enableEvidenceDiscipline flag 控制. 默认 false.
//
// 与 Hindsight 区别:
//   - Hindsight: 无显式 evidence discipline (靠 Reflect Agent 多轮)
//   - ClawX: 结构化输出 + runtime 校验 (确定性, 无额外 LLM 成本)

import type { EvidenceDisciplineTrace } from "./memory-trace.js";

// === Schema ===

/**
 * 生成端输出 (含 usedFactIds).
 *
 * 模型应按此格式输出 (JSON 或 FACT_IDS: 尾注).
 */
export type GeneratedOutput = {
  /** 模型生成的答案文本 */
  answer: string;
  /** 模型引用的 fact IDs (evidence) */
  usedFactIds: string[];
  /**
   * 可选: 模型引用的 observation IDs (若从 observation 展开支持)
   * supportFactIdsExpanded 会展开这些 observation 的 supportFactIds
   */
  usedObservationIds?: string[];
};

/**
 * Evidence discipline 校验结果.
 */
export type EvidenceCheckResult = {
  /** 校验是否通过 (usedFactIds ⊆ allowed) */
  validated: boolean;
  /** 失败原因 (validated=false 时) */
  failureReason?: string;
  /** 不在 allowed 集合中的 fact IDs (hallucinated) */
  hallucinatedFactIds: string[];
  /** 用于 trace 的记录 */
  trace: EvidenceDisciplineTrace;
};

// === 核心校验函数 ===

/**
 * 校验 usedFactIds 是否是 recalledFacts/supportFactIdsExpanded 的子集.
 *
 * @param output 模型输出 (含 usedFactIds)
 * @param recalledFactIds recalled facts 的 fact IDs
 * @param supportFactIdsExpanded 从 observation 展开的 support fact IDs
 * @returns 校验结果 (含 trace)
 */
export function validateEvidenceDiscipline(
  output: GeneratedOutput,
  recalledFactIds: readonly string[],
  supportFactIdsExpanded: readonly string[] = [],
): EvidenceCheckResult {
  const allowed = new Set<string>([...recalledFactIds, ...supportFactIdsExpanded]);

  // 找出 hallucinated fact IDs (不在 allowed 中)
  const hallucinatedFactIds: string[] = [];
  for (const fid of output.usedFactIds) {
    if (!allowed.has(fid)) {
      hallucinatedFactIds.push(fid);
    }
  }

  const validated = hallucinatedFactIds.length === 0;
  const failureReason = validated
    ? undefined
    : `usedFactIds contains ${hallucinatedFactIds.length} fact(s) not in recalledFacts ∪ supportFactIdsExpanded: ${hallucinatedFactIds.slice(0, 5).join(", ")}${hallucinatedFactIds.length > 5 ? "..." : ""}`;

  const trace: EvidenceDisciplineTrace = {
    enabled: true,
    usedFactIds: [...output.usedFactIds],
    validated,
    ...(failureReason ? { failureReason } : {}),
    regenerated: false, // 调用方在降级时更新
  };

  return { validated, failureReason, hallucinatedFactIds, trace };
}

// === 降级策略 ===

/**
 * 降级策略类型.
 */
export type DegradationStrategy = "insufficient_evidence" | "regenerate";

/**
 * Evidence discipline 降级配置.
 */
export type EvidenceDisciplineConfig = {
  /** 降级策略 (默认 insufficient_evidence) */
  degradationStrategy: DegradationStrategy;
  /** 最大重新生成次数 (受 budget 限制, 默认 1) */
  maxRegenerateCount: number;
};

export const DEFAULT_EVIDENCE_DISCIPLINE_CONFIG: EvidenceDisciplineConfig = {
  degradationStrategy: "insufficient_evidence",
  maxRegenerateCount: 1,
};

/**
 * 应用降级策略.
 *
 * @param strategy 降级策略
 * @param originalOutput 原始输出 (validated=false)
 * @param regenerateCount 已重新生成次数
 * @param maxRegenerateCount 最大重新生成次数
 * @returns 降级后的输出 + trace 更新
 */
export function applyEvidenceDegradation(
  strategy: DegradationStrategy,
  originalOutput: GeneratedOutput,
  regenerateCount: number,
  maxRegenerateCount: number = 1,
): {
  degradedOutput: GeneratedOutput;
  degraded: boolean;
  shouldRegenerate: boolean;
  traceUpdate: Partial<EvidenceDisciplineTrace>;
} {
  if (strategy === "regenerate" && regenerateCount < maxRegenerateCount) {
    // 策略 B: 强制重新生成 (受 budget 限制)
    return {
      degradedOutput: originalOutput, // 调用方负责实际重新生成
      degraded: false,
      shouldRegenerate: true,
      traceUpdate: {
        regenerated: true,
        regenerateCount: regenerateCount + 1,
      },
    };
  }

  // 策略 A: 返回 INSUFFICIENT_EVIDENCE (默认)
  return {
    degradedOutput: {
      answer: "INSUFFICIENT_EVIDENCE",
      usedFactIds: [],
    },
    degraded: true,
    shouldRegenerate: false,
    traceUpdate: {
      regenerated: regenerateCount > 0,
      ...(regenerateCount > 0 ? { regenerateCount } : {}),
    },
  };
}

// === 模型输出 parse (从 JSON 或 FACT_IDS: 尾注) ===

/**
 * 从模型输出文本 parse usedFactIds.
 *
 * 支持两种格式:
 *   1. JSON 输出: {"answer": "...", "usedFactIds": ["f1", "f2"]}
 *   2. FACT_IDS 尾注: "答案文本\nFACT_IDS: f1,f2,f3"
 *
 * @param rawOutput 模型原始输出文本
 * @returns parsed output (或 null 表示 parse 失败)
 */
export function parseGeneratedOutput(rawOutput: string): GeneratedOutput | null {
  if (!rawOutput || typeof rawOutput !== "string") return null;

  // 尝试 JSON parse
  try {
    const trimmed = rawOutput.trim();
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as {
        answer?: string;
        usedFactIds?: string[];
        usedObservationIds?: string[];
      };
      if (typeof parsed.answer === "string") {
        return {
          answer: parsed.answer,
          usedFactIds: Array.isArray(parsed.usedFactIds)
            ? parsed.usedFactIds.filter((id) => typeof id === "string")
            : [],
          ...(Array.isArray(parsed.usedObservationIds)
            ? { usedObservationIds: parsed.usedObservationIds }
            : {}),
        };
      }
    }
  } catch {
    // JSON parse 失败, 尝试 FACT_IDS 尾注
  }

  // 尝试 FACT_IDS: 尾注
  const factIdsMatch = rawOutput.match(
    /FACT_IDS:\s*([a-zA-Z0-9_,\s]+)/i,
  );
  if (factIdsMatch) {
    const factIdsStr = factIdsMatch[1].trim();
    const usedFactIds = factIdsStr
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const answer = rawOutput.replace(factIdsMatch[0], "").trim();
    return { answer, usedFactIds };
  }

  // 无法 parse usedFactIds, 返回 answer only (usedFactIds=[])
  return {
    answer: rawOutput.trim(),
    usedFactIds: [],
  };
}

// === 端到端校验 + 降级 (便捷工具) ===

/**
 * 端到端: 校验 + 降级 + 更新 trace.
 *
 * 用法:
 *   const result = enforceEvidenceDiscipline(output, recalledIds, expandedIds, config);
 *   if (result.shouldRegenerate) { ... 重新生成 ... }
 *   builder.setEvidenceDiscipline(result.trace);
 *
 * @param output 模型输出
 * @param recalledFactIds recalled facts
 * @param supportFactIdsExpanded 展开的 support facts
 * @param config 降级配置
 * @param regenerateCount 当前已重新生成次数
 * @returns 校验结果 + 降级输出 + 最终 trace
 */
export function enforceEvidenceDiscipline(
  output: GeneratedOutput,
  recalledFactIds: readonly string[],
  supportFactIdsExpanded: readonly string[],
  config: EvidenceDisciplineConfig = DEFAULT_EVIDENCE_DISCIPLINE_CONFIG,
  regenerateCount: number = 0,
): {
  finalOutput: GeneratedOutput;
  validated: boolean;
  shouldRegenerate: boolean;
  trace: EvidenceDisciplineTrace;
} {
  const check = validateEvidenceDiscipline(
    output,
    recalledFactIds,
    supportFactIdsExpanded,
  );

  if (check.validated) {
    return {
      finalOutput: output,
      validated: true,
      shouldRegenerate: false,
      trace: check.trace,
    };
  }

  // 校验失败, 应用降级
  const degradation = applyEvidenceDegradation(
    config.degradationStrategy,
    output,
    regenerateCount,
    config.maxRegenerateCount,
  );

  const trace: EvidenceDisciplineTrace = {
    ...check.trace,
    ...degradation.traceUpdate,
  };

  return {
    finalOutput: degradation.degradedOutput,
    validated: false,
    shouldRegenerate: degradation.shouldRegenerate,
    trace,
  };
}
