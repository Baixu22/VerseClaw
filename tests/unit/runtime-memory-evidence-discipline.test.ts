// @vitest-environment node
// WP4 (Week 7-8): Evidence discipline 单元测试.
//
// 覆盖 memory-evidence-discipline.ts:
//   - validateEvidenceDiscipline: case1 usedFactIds 合法 → validated=true
//   - validateEvidenceDiscipline: case2 usedFactIds 引用未知 fact → validated=false
//   - applyEvidenceDegradation: insufficient_evidence 策略返回 INSUFFICIENT_EVIDENCE
//   - applyEvidenceDegradation: regenerate 策略触发 shouldRegenerate=true (受 budget 限制)
//   - applyEvidenceDegradation: regenerate 超过 maxRegenerateCount 时降级为 insufficient_evidence
//   - parseGeneratedOutput: JSON 输出 / FACT_IDS 尾注 / 无 usedFactIds
//   - enforceEvidenceDiscipline: 端到端 (校验 + 降级 + trace)
//   - evidenceDiscipline trace 字段完整性
import { describe, expect, it } from "vitest";
import {
  applyEvidenceDegradation,
  DEFAULT_EVIDENCE_DISCIPLINE_CONFIG,
  enforceEvidenceDiscipline,
  parseGeneratedOutput,
  validateEvidenceDiscipline,
  type EvidenceDisciplineConfig,
  type GeneratedOutput,
} from "../../openclaw_runtime/src/runtime-core/memory-evidence-discipline.js";
import {
  createRecallTraceBuilder,
  type RecallTrace,
} from "../../openclaw_runtime/src/runtime-core/memory-trace.js";

// === WP4: Evidence discipline ===

describe("WP4: Evidence discipline", () => {
  // 1. case1: usedFactIds 合法 → validated=true
  it("should_validate_when_usedFactIds_subset_of_recalledFacts", () => {
    const output: GeneratedOutput = {
      answer: "Jon lives in Boston.",
      usedFactIds: ["f1", "f2"],
    };
    const recalledFactIds = ["f1", "f2", "f3"];

    const result = validateEvidenceDiscipline(output, recalledFactIds);

    expect(result.validated).toBe(true);
    expect(result.hallucinatedFactIds).toEqual([]);
    expect(result.failureReason).toBeUndefined();
    // trace 字段
    expect(result.trace.enabled).toBe(true);
    expect(result.trace.usedFactIds).toEqual(["f1", "f2"]);
    expect(result.trace.validated).toBe(true);
    expect(result.trace.regenerated).toBe(false);
  });

  // 2. case2: usedFactIds 引用未知 fact → validated=false + 触发降级
  it("should_invalidate_when_usedFactIds_contains_unknown_fact", () => {
    const output: GeneratedOutput = {
      answer: "Jon lives in Boston.",
      usedFactIds: ["f1", "f_unknown"], // f_unknown 不在 recalledFacts
    };
    const recalledFactIds = ["f1", "f2", "f3"];

    const result = validateEvidenceDiscipline(output, recalledFactIds);

    expect(result.validated).toBe(false);
    expect(result.hallucinatedFactIds).toEqual(["f_unknown"]);
    expect(result.failureReason).toContain("f_unknown");
    // trace 字段
    expect(result.trace.validated).toBe(false);
    expect(result.trace.failureReason).toBeDefined();
    expect(result.trace.failureReason).toContain("f_unknown");
  });

  // 3. supportFactIdsExpanded 也算合法来源
  it("should_accept_usedFactIds_from_supportFactIdsExpanded", () => {
    const output: GeneratedOutput = {
      answer: "answer",
      usedFactIds: ["f_recalled", "f_expanded"],
    };
    const recalledFactIds = ["f_recalled"];
    const supportFactIdsExpanded = ["f_expanded", "f_other_expanded"];

    const result = validateEvidenceDiscipline(
      output,
      recalledFactIds,
      supportFactIdsExpanded,
    );

    expect(result.validated).toBe(true);
    expect(result.hallucinatedFactIds).toEqual([]);
  });

  // 4. applyEvidenceDegradation: insufficient_evidence 策略
  it("should_degrade_to_INSUFFICIENT_EVIDENCE_with_strategy_A", () => {
    const output: GeneratedOutput = {
      answer: "fabricated answer",
      usedFactIds: ["f_unknown"],
    };

    const result = applyEvidenceDegradation(
      "insufficient_evidence",
      output,
      0,
      1,
    );

    expect(result.degraded).toBe(true);
    expect(result.shouldRegenerate).toBe(false);
    expect(result.degradedOutput.answer).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.degradedOutput.usedFactIds).toEqual([]);
    // trace 更新
    expect(result.traceUpdate.regenerated).toBe(false);
  });

  // 5. applyEvidenceDegradation: regenerate 策略 (未达上限)
  it("should_trigger_regeneration_with_strategy_B_under_budget", () => {
    const output: GeneratedOutput = {
      answer: "fabricated",
      usedFactIds: ["f_unknown"],
    };

    // regenerateCount=0, maxRegenerateCount=1 → 还可以重新生成一次
    const result = applyEvidenceDegradation("regenerate", output, 0, 1);

    expect(result.degraded).toBe(false);
    expect(result.shouldRegenerate).toBe(true);
    // 调用方负责实际重新生成, degradedOutput 保持原样
    expect(result.degradedOutput).toBe(output);
    // trace 更新
    expect(result.traceUpdate.regenerated).toBe(true);
    expect(result.traceUpdate.regenerateCount).toBe(1);
  });

  // 6. applyEvidenceDegradation: regenerate 超过 budget 时降级
  it("should_fall_back_to_INSUFFICIENT_EVIDENCE_when_regenerate_budget_exhausted", () => {
    const output: GeneratedOutput = {
      answer: "fabricated",
      usedFactIds: ["f_unknown"],
    };

    // regenerateCount=1, maxRegenerateCount=1 → 已达上限, 降级
    const result = applyEvidenceDegradation("regenerate", output, 1, 1);

    expect(result.degraded).toBe(true);
    expect(result.shouldRegenerate).toBe(false);
    expect(result.degradedOutput.answer).toBe("INSUFFICIENT_EVIDENCE");
    // trace 更新: regenerated=true (因为之前已重新生成过一次)
    expect(result.traceUpdate.regenerated).toBe(true);
    expect(result.traceUpdate.regenerateCount).toBe(1);
  });

  // 7. parseGeneratedOutput: JSON 输出
  it("should_parse_JSON_output_with_usedFactIds", () => {
    const raw = JSON.stringify({
      answer: "Jon lives in Boston.",
      usedFactIds: ["f1", "f2"],
    });

    const parsed = parseGeneratedOutput(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.answer).toBe("Jon lives in Boston.");
    expect(parsed?.usedFactIds).toEqual(["f1", "f2"]);
  });

  // 8. parseGeneratedOutput: JSON 输出含 usedObservationIds
  it("should_parse_JSON_output_with_usedObservationIds", () => {
    const raw = JSON.stringify({
      answer: "answer",
      usedFactIds: ["f1"],
      usedObservationIds: ["obs1", "obs2"],
    });

    const parsed = parseGeneratedOutput(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.usedObservationIds).toEqual(["obs1", "obs2"]);
  });

  // 9. parseGeneratedOutput: FACT_IDS 尾注
  it("should_parse_FACT_IDS_suffix", () => {
    const raw = "Jon lives in Boston.\nFACT_IDS: f1, f2, f3";

    const parsed = parseGeneratedOutput(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.answer).toBe("Jon lives in Boston.");
    expect(parsed?.usedFactIds).toEqual(["f1", "f2", "f3"]);
  });

  // 10. parseGeneratedOutput: 无 usedFactIds (返回空数组)
  it("should_return_empty_usedFactIds_when_no_evidence_marker", () => {
    const raw = "Just a plain answer without evidence markers.";

    const parsed = parseGeneratedOutput(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.answer).toBe("Just a plain answer without evidence markers.");
    expect(parsed?.usedFactIds).toEqual([]);
  });

  // 11. parseGeneratedOutput: null/empty 输入 (空字符串返回 null)
  it("should_handle_null_or_empty_input_in_parse", () => {
    // 空字符串: parseGeneratedOutput 返回 null (guard clause: !rawOutput)
    expect(parseGeneratedOutput("")).toBeNull();
  });

  // 12. enforceEvidenceDiscipline: 端到端 — 校验通过
  it("enforceEvidenceDiscipline_passes_for_valid_output", () => {
    const output: GeneratedOutput = {
      answer: "answer",
      usedFactIds: ["f1"],
    };

    const result = enforceEvidenceDiscipline(
      output,
      ["f1", "f2"],
      [],
      DEFAULT_EVIDENCE_DISCIPLINE_CONFIG,
      0,
    );

    expect(result.validated).toBe(true);
    expect(result.shouldRegenerate).toBe(false);
    expect(result.finalOutput).toBe(output);
    expect(result.trace.enabled).toBe(true);
    expect(result.trace.validated).toBe(true);
    expect(result.trace.regenerated).toBe(false);
  });

  // 13. enforceEvidenceDiscipline: 端到端 — 校验失败 + 降级 (insufficient_evidence)
  it("enforceEvidenceDiscipline_degrades_for_invalid_output_strategy_A", () => {
    const output: GeneratedOutput = {
      answer: "fabricated",
      usedFactIds: ["f_unknown"],
    };
    const config: EvidenceDisciplineConfig = {
      degradationStrategy: "insufficient_evidence",
      maxRegenerateCount: 1,
    };

    const result = enforceEvidenceDiscipline(
      output,
      ["f1"],
      [],
      config,
      0,
    );

    expect(result.validated).toBe(false);
    expect(result.shouldRegenerate).toBe(false);
    expect(result.finalOutput.answer).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.finalOutput.usedFactIds).toEqual([]);
    expect(result.trace.validated).toBe(false);
    expect(result.trace.failureReason).toBeDefined();
  });

  // 14. enforceEvidenceDiscipline: 端到端 — 校验失败 + regenerate (受 budget)
  it("enforceEvidenceDiscipline_triggers_regeneration_strategy_B", () => {
    const output: GeneratedOutput = {
      answer: "fabricated",
      usedFactIds: ["f_unknown"],
    };
    const config: EvidenceDisciplineConfig = {
      degradationStrategy: "regenerate",
      maxRegenerateCount: 1,
    };

    const result = enforceEvidenceDiscipline(
      output,
      ["f1"],
      [],
      config,
      0, // 还可以重新生成
    );

    expect(result.validated).toBe(false);
    expect(result.shouldRegenerate).toBe(true);
    // 调用方负责实际重新生成, finalOutput 保持原样
    expect(result.finalOutput).toBe(output);
    expect(result.trace.regenerated).toBe(true);
    expect(result.trace.regenerateCount).toBe(1);
  });

  // 15. enforceEvidenceDiscipline: regenerate 超过 budget 时降级
  it("enforceEvidenceDiscipline_degrades_when_regenerate_budget_exhausted", () => {
    const output: GeneratedOutput = {
      answer: "fabricated",
      usedFactIds: ["f_unknown"],
    };
    const config: EvidenceDisciplineConfig = {
      degradationStrategy: "regenerate",
      maxRegenerateCount: 1,
    };

    const result = enforceEvidenceDiscipline(
      output,
      ["f1"],
      [],
      config,
      1, // 已达上限
    );

    expect(result.validated).toBe(false);
    expect(result.shouldRegenerate).toBe(false);
    expect(result.finalOutput.answer).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.trace.regenerated).toBe(true);
  });

  // 16. evidenceDiscipline trace 写入 RecallTrace
  it("should_write_evidenceDiscipline_to_RecallTrace", () => {
    const output: GeneratedOutput = {
      answer: "Jon lives in Boston.",
      usedFactIds: ["f1"],
    };
    const recalledFactIds = ["f1", "f2"];

    const result = enforceEvidenceDiscipline(
      output,
      recalledFactIds,
      [],
      DEFAULT_EVIDENCE_DISCIPLINE_CONFIG,
      0,
    );

    // 写入 RecallTrace
    const builder = createRecallTraceBuilder({
      questionId: "Q1",
      query: "Where does Jon live?",
    });
    builder.setEvidenceDiscipline(result.trace);
    const trace: RecallTrace = builder.build();

    expect(trace.evidenceDiscipline).toBeDefined();
    expect(trace.evidenceDiscipline?.enabled).toBe(true);
    expect(trace.evidenceDiscipline?.usedFactIds).toEqual(["f1"]);
    expect(trace.evidenceDiscipline?.validated).toBe(true);
    expect(trace.evidenceDiscipline?.regenerated).toBe(false);
  });

  // 17. DEFAULT_EVIDENCE_DISCIPLINE_CONFIG 默认值
  it("should_have_sensible_default_config", () => {
    expect(DEFAULT_EVIDENCE_DISCIPLINE_CONFIG.degradationStrategy).toBe(
      "insufficient_evidence",
    );
    expect(DEFAULT_EVIDENCE_DISCIPLINE_CONFIG.maxRegenerateCount).toBe(1);
  });
});
