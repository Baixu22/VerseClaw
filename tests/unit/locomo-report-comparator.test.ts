// WP-E4: Report comparator 测试.
//
// 覆盖:
//   - normalizeReportMetrics() 双 schema 归一化 (camelCase + snake_case)
//   - compareReports() delta 计算 + hasRegression 判定 + threshold
//   - loadReportFromFile() / loadBaselineReport() 文件加载
//   - formatRegressionMarkdown() markdown 输出格式
//   - 集成测试: 真实 phase3/phase4/current baseline reports

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  normalizeReportMetrics,
  compareReports,
  loadReportFromFile,
  loadBaselineReport,
  formatRegressionMarkdown,
} from "./helpers/locomo-report-comparator.js";

// === Fixtures ===

// 旧 schema (phase3/phase4 风格): overall 用 snake_case, byCategory 用 camelCase
const legacyReport = {
  dataset: "locomo",
  version: "3.1-full-500-phase3-augment",
  totalQuestions: 500,
  judgeModel: "DeepSeek (LLM-as-Judge)",
  metric: "J Score (LLM-as-Judge accuracy)",
  adversarialExcluded: true,
  sampleSizes: { multi_hop: 96, temporal: 150, single_hop: 127, open_domain: 127 },
  sampleSeed: 42,
  metrics: {
    overall: {
      j_score: 0.452,
      recall_at_5: 0.4672499746973088,
    },
    byCategory: {
      temporal: { jScore: 0.35333333333333333, recallAt5: 0.6376666666666667, count: 150 },
      multi_hop: { jScore: 0.4270833333333333, recallAt5: 0.1887906136261399, count: 96 },
      single_hop: { jScore: 0.5275590551181102, recallAt5: 0.3726432410641586, count: 127 },
      open_domain: { jScore: 0.5118110236220472, recallAt5: 0.5710661167354082, count: 127 },
    },
  },
  comparison: { ours: { j_score: 0.452 } },
  generatedAt: "2026-07-01T17:43:26.579Z",
};

// 新 schema (current 风格): overall + byCategory 都用 snake_case, 多了 context_recall
const currentReport = {
  dataset: "locomo",
  version: "10.0-stage2-adaptive-retrieval",
  totalQuestions: 500,
  judgeModel: "deepseek-chat (frozen-v2-generous-2026-07-04)",
  metric: "J Score (frozen LLM-as-Judge accuracy)",
  adversarialExcluded: true,
  sampleSizes: { multi_hop: 96, temporal: 150, single_hop: 127, open_domain: 127 },
  sampleSeed: 42,
  metrics: {
    overall: {
      j_score: 0.718,
      recall_at_5: 0.49785195945265603,
      context_recall: 0.008,
    },
    byCategory: {
      temporal: { j_score: 0.7866666666666666, recall_at_5: 0.5181481481481481, context_recall: 0, count: 150 },
      multi_hop: { j_score: 0.5208333333333334, recall_at_5: 0.24067886076520936, context_recall: 0.041666666666666664, count: 96 },
      single_hop: { j_score: 0.7401574803149606, recall_at_5: 0.4939333799338431, context_recall: 0, count: 127 },
      open_domain: { j_score: 0.8110236220472441, recall_at_5: 0.6259842519685039, context_recall: 0, count: 127 },
    },
  },
  generatedAt: "2026-07-04T08:00:00.000Z",
};

const ARTIFACT_DIR = join(process.cwd(), "artifacts", "runtime-memory-eval");

// === normalizeReportMetrics ===

describe("normalizeReportMetrics", () => {
  it("归一化旧 schema (camelCase byCategory)", () => {
    const m = normalizeReportMetrics(legacyReport, "phase3");
    expect(m.source).toBe("phase3");
    expect(m.version).toBe("3.1-full-500-phase3-augment");
    expect(m.totalQuestions).toBe(500);
    expect(m.overallJ).toBeCloseTo(0.452, 6);
    expect(m.overallRecall5).toBeCloseTo(0.4672499746973088, 10);
    expect(m.overallContextRecall).toBeUndefined();
    expect(m.byCategoryJ.temporal).toBeCloseTo(0.35333333333333333, 14);
    expect(m.byCategoryJ.multi_hop).toBeCloseTo(0.4270833333333333, 14);
    expect(m.byCategoryJ.single_hop).toBeCloseTo(0.5275590551181102, 14);
    expect(m.byCategoryJ.open_domain).toBeCloseTo(0.5118110236220472, 14);
    expect(m.byCategoryRecall5.temporal).toBeCloseTo(0.6376666666666667, 14);
    expect(m.byCategoryRecall5.multi_hop).toBeCloseTo(0.1887906136261399, 14);
    expect(m.byCategoryCount).toEqual({ temporal: 150, multi_hop: 96, single_hop: 127, open_domain: 127 });
    expect(m.byCategoryContextRecall).toBeUndefined();
    expect(m.generatedAt).toBe("2026-07-01T17:43:26.579Z");
  });

  it("归一化新 schema (snake_case byCategory)", () => {
    const m = normalizeReportMetrics(currentReport, "current");
    expect(m.source).toBe("current");
    expect(m.version).toBe("10.0-stage2-adaptive-retrieval");
    expect(m.overallJ).toBeCloseTo(0.718, 6);
    expect(m.overallRecall5).toBeCloseTo(0.49785195945265603, 14);
    expect(m.overallContextRecall).toBeCloseTo(0.008, 6);
    expect(m.byCategoryJ.temporal).toBeCloseTo(0.7866666666666666, 14);
    expect(m.byCategoryJ.multi_hop).toBeCloseTo(0.5208333333333334, 14);
    expect(m.byCategoryRecall5.temporal).toBeCloseTo(0.5181481481481481, 14);
    expect(m.byCategoryContextRecall?.temporal).toBe(0);
    expect(m.byCategoryContextRecall?.multi_hop).toBeCloseTo(0.041666666666666664, 14);
    expect(m.byCategoryCount).toEqual({ temporal: 150, multi_hop: 96, single_hop: 127, open_domain: 127 });
    expect(m.generatedAt).toBe("2026-07-04T08:00:00.000Z");
  });

  it("空 report 返回零值", () => {
    const m = normalizeReportMetrics({}, "empty");
    expect(m.source).toBe("empty");
    expect(m.version).toBeUndefined();
    expect(m.totalQuestions).toBe(0);
    expect(m.overallJ).toBe(0);
    expect(m.overallRecall5).toBeUndefined();
    expect(m.overallContextRecall).toBeUndefined();
    expect(m.byCategoryJ).toEqual({});
    expect(m.byCategoryRecall5).toEqual({});
    expect(m.byCategoryCount).toEqual({});
    expect(m.byCategoryContextRecall).toBeUndefined();
    expect(m.generatedAt).toBeUndefined();
  });

  it("missing metrics 字段不报错", () => {
    const m = normalizeReportMetrics({ totalQuestions: 100 }, "partial");
    expect(m.totalQuestions).toBe(100);
    expect(m.overallJ).toBe(0);
    expect(m.byCategoryJ).toEqual({});
  });

  it("非 number 字段降级为 0", () => {
    const m = normalizeReportMetrics({
      totalQuestions: "500", // string, 降级为 0
      metrics: {
        overall: { j_score: "0.5" }, // string, 降级为 0
        byCategory: {
          temporal: { jScore: null, count: "150" }, // null/string 降级
        },
      },
    }, "bad-types");
    expect(m.totalQuestions).toBe(0);
    expect(m.overallJ).toBe(0);
    expect(m.byCategoryJ.temporal).toBe(0);
    expect(m.byCategoryCount.temporal).toBe(0);
  });

  it("version 非 string 时为 undefined", () => {
    const m = normalizeReportMetrics({ version: 123 }, "x");
    expect(m.version).toBeUndefined();
  });

  it("generatedAt 非 string 时为 undefined", () => {
    const m = normalizeReportMetrics({ generatedAt: 123 }, "x");
    expect(m.generatedAt).toBeUndefined();
  });

  it("byCategory 同时含两种 schema 时优先 snake_case", () => {
    // 同时存在 j_score 和 jScore — 取 snake_case
    const m = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { j_score: 0.6, jScore: 0.7, recall_at_5: 0.5, recallAt5: 0.4, count: 10 },
        },
      },
    }, "mixed");
    expect(m.byCategoryJ.temporal).toBe(0.6);
    expect(m.byCategoryRecall5.temporal).toBe(0.5);
  });

  it("byCategory 仅含 camelCase 时正确读取", () => {
    const m = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { jScore: 0.7, recallAt5: 0.4, count: 10 },
        },
      },
    }, "legacy-only");
    expect(m.byCategoryJ.temporal).toBe(0.7);
    expect(m.byCategoryRecall5.temporal).toBe(0.4);
    expect(m.byCategoryContextRecall).toBeUndefined();
  });
});

// === compareReports ===

describe("compareReports", () => {
  it("等同 report 返回零 delta, 无 regression, 无 improvement", () => {
    const baseline = normalizeReportMetrics(legacyReport, "b");
    const delta = compareReports(baseline, baseline);
    expect(delta.overallJ).toBe(0);
    expect(delta.hasRegression).toBe(false);
    expect(delta.regressedCategories).toEqual([]);
    expect(delta.improvedCategories).toEqual([]);
    expect(delta.threshold).toBe(0.01);
    for (const d of Object.values(delta.byCategoryJ)) {
      expect(d).toBe(0);
    }
  });

  it("提升场景: current > baseline → improvedCategories, 无 regression", () => {
    const baseline = normalizeReportMetrics(legacyReport, "phase3");
    const current = normalizeReportMetrics(currentReport, "current");
    const delta = compareReports(baseline, current);
    // overall J: 0.718 - 0.452 = +0.266 (大幅提升)
    expect(delta.overallJ).toBeCloseTo(0.266, 4);
    expect(delta.hasRegression).toBe(false);
    expect(delta.improvedCategories.length).toBeGreaterThan(0);
    expect(delta.improvedCategories).toContain("temporal");
    expect(delta.improvedCategories).toContain("multi_hop");
    expect(delta.improvedCategories).toContain("single_hop");
    expect(delta.improvedCategories).toContain("open_domain");
    expect(delta.regressedCategories).toEqual([]);
  });

  it("回归场景: current < baseline → regressedCategories + hasRegression", () => {
    // phase3 (0.452) → phase4 (0.386) = -0.066 (回归)
    const phase3 = normalizeReportMetrics(legacyReport, "phase3");
    const phase4Like = normalizeReportMetrics({
      ...legacyReport,
      version: "4.0-regression",
      metrics: {
        overall: { j_score: 0.386, recall_at_5: 0.4374670217295605 },
        byCategory: {
          temporal: { jScore: 0.3, recallAt5: 0.5874444444444445, count: 150 },
          multi_hop: { jScore: 0.3854166666666667, recallAt5: 0.17048478750781382, count: 96 },
          single_hop: { jScore: 0.44881889763779526, recallAt5: 0.33103914381126054, count: 127 },
          open_domain: { jScore: 0.4251968503937008, recallAt5: 0.5685695538057742, count: 127 },
        },
      },
    }, "phase4");
    const delta = compareReports(phase3, phase4Like);
    expect(delta.overallJ).toBeCloseTo(-0.066, 4);
    expect(delta.hasRegression).toBe(true);
    expect(delta.regressedCategories.length).toBeGreaterThan(0);
    expect(delta.regressedCategories).toContain("temporal");
    expect(delta.improvedCategories).toEqual([]);
  });

  it("混合场景: 部分 category 提升, 部分回归", () => {
    const baseline = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { j_score: 0.5, count: 10 },
          multi_hop: { j_score: 0.5, count: 10 },
          single_hop: { j_score: 0.5, count: 10 },
        },
      },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { j_score: 0.7, count: 10 }, // +0.20 改善
          multi_hop: { j_score: 0.3, count: 10 }, // -0.20 回归
          single_hop: { j_score: 0.5, count: 10 }, // 0 无变化
        },
      },
    }, "c");
    const delta = compareReports(baseline, current);
    expect(delta.overallJ).toBe(0);
    expect(delta.hasRegression).toBe(true);
    expect(delta.regressedCategories).toEqual(["multi_hop"]);
    expect(delta.improvedCategories).toEqual(["temporal"]);
    expect(delta.byCategoryJ.temporal).toBeCloseTo(0.2, 6);
    expect(delta.byCategoryJ.multi_hop).toBeCloseTo(-0.2, 6);
    expect(delta.byCategoryJ.single_hop).toBe(0);
  });

  it("threshold 自定义: 大 threshold 时小变化不算 regression", () => {
    const baseline = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: { temporal: { j_score: 0.5, count: 10 } },
      },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: { temporal: { j_score: 0.49, count: 10 } }, // ≈ -0.01 (含浮点误差)
      },
    }, "c");
    // threshold 0.02 → delta ≈ -0.01 > -0.02, 不算回归
    const d1 = compareReports(baseline, current, 0.02);
    expect(d1.hasRegression).toBe(false);
    expect(d1.regressedCategories).toEqual([]);
    expect(d1.threshold).toBe(0.02);
    // threshold 0.005 → delta ≈ -0.01 < -0.005, 算回归
    const d2 = compareReports(baseline, current, 0.005);
    expect(d2.hasRegression).toBe(true);
    expect(d2.regressedCategories).toEqual(["temporal"]);
    expect(d2.threshold).toBe(0.005);
  });

  it("overall J 单独回归也触发 hasRegression", () => {
    const baseline = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: { temporal: { j_score: 0.5, count: 10 } },
      },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.4 }, // -0.10
        byCategory: { temporal: { j_score: 0.5, count: 10 } }, // 0
      },
    }, "c");
    const delta = compareReports(baseline, current);
    expect(delta.overallJ).toBeCloseTo(-0.1, 6);
    expect(delta.hasRegression).toBe(true);
    expect(delta.regressedCategories).toEqual([]); // category 无回归
  });

  it("recall5 一侧缺失 → overallRecall5 为 undefined", () => {
    const baseline = normalizeReportMetrics({
      metrics: { overall: { j_score: 0.5, recall_at_5: 0.4 } },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: { overall: { j_score: 0.6 } }, // 无 recall_at_5
    }, "c");
    const delta = compareReports(baseline, current);
    expect(delta.overallJ).toBeCloseTo(0.1, 6);
    expect(delta.overallRecall5).toBeUndefined();
  });

  it("category 仅一侧存在 → 该 category delta 跳过", () => {
    const baseline = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { j_score: 0.5, count: 10 },
          only_in_baseline: { j_score: 0.6, count: 5 },
        },
      },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { j_score: 0.7, count: 10 }, // +0.20
          only_in_current: { j_score: 0.8, count: 5 },
        },
      },
    }, "c");
    const delta = compareReports(baseline, current);
    expect(delta.byCategoryJ.temporal).toBeCloseTo(0.2, 6);
    // only_in_baseline 和 only_in_current 不在 delta 中 (双侧都有才计算)
    expect(delta.byCategoryJ.only_in_baseline).toBeUndefined();
    expect(delta.byCategoryJ.only_in_current).toBeUndefined();
    expect(delta.improvedCategories).toEqual(["temporal"]);
  });

  it("context_recall 双侧存在时计算 delta", () => {
    const baseline = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5, context_recall: 0.1 },
        byCategory: { temporal: { j_score: 0.5, context_recall: 0.1, count: 10 } },
      },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5, context_recall: 0.3 },
        byCategory: { temporal: { j_score: 0.5, context_recall: 0.3, count: 10 } },
      },
    }, "c");
    const delta = compareReports(baseline, current);
    expect(delta.overallContextRecall).toBeCloseTo(0.2, 6);
  });
});

// === loadReportFromFile / loadBaselineReport ===

describe("loadReportFromFile", () => {
  it("文件不存在 → throw", () => {
    expect(() => loadReportFromFile(join(ARTIFACT_DIR, "nonexistent.json"))).toThrow(
      /Report file not found/,
    );
  });

  it("加载真实 phase3 baseline", () => {
    const path = join(ARTIFACT_DIR, "locomo-full-500-report-phase3-baseline.json");
    const m = loadReportFromFile(path, "phase3");
    expect(m.source).toBe("phase3");
    expect(m.version).toBe("3.1-full-500-phase3-augment");
    expect(m.totalQuestions).toBe(500);
    expect(m.overallJ).toBeCloseTo(0.452, 6);
    expect(m.overallRecall5).toBeCloseTo(0.4672499746973088, 10);
    // phase3 旧 schema — byCategory camelCase
    expect(m.byCategoryJ.temporal).toBeCloseTo(0.35333333333333333, 14);
    expect(m.byCategoryJ.multi_hop).toBeCloseTo(0.4270833333333333, 14);
    expect(m.byCategoryCount).toEqual({ temporal: 150, multi_hop: 96, single_hop: 127, open_domain: 127 });
  });

  it("加载真实 phase4 regression baseline", () => {
    const path = join(ARTIFACT_DIR, "locomo-full-500-report-phase4.0-regression.json");
    const m = loadReportFromFile(path, "phase4");
    expect(m.source).toBe("phase4");
    expect(m.version).toBe("4.0-full-500-phase4-query-rewrite");
    expect(m.overallJ).toBeCloseTo(0.386, 6);
    // phase4 旧 schema — byCategory camelCase
    expect(m.byCategoryJ.temporal).toBeCloseTo(0.3, 6);
    expect(m.byCategoryJ.multi_hop).toBeCloseTo(0.3854166666666667, 14);
  });

  it("加载真实 current report (新 schema)", () => {
    const path = join(ARTIFACT_DIR, "locomo-full-500-report.json");
    const m = loadReportFromFile(path, "current");
    expect(m.source).toBe("current");
    expect(m.version).toBe("10.0-stage2-adaptive-retrieval");
    expect(m.overallJ).toBeCloseTo(0.718, 6);
    expect(m.overallContextRecall).toBeCloseTo(0.008, 6);
    // 新 schema — byCategory snake_case
    expect(m.byCategoryJ.temporal).toBeCloseTo(0.7866666666666666, 14);
    expect(m.byCategoryJ.multi_hop).toBeCloseTo(0.5208333333333334, 14);
    expect(m.byCategoryContextRecall?.temporal).toBe(0);
    expect(m.byCategoryContextRecall?.multi_hop).toBeCloseTo(0.041666666666666664, 14);
  });

  it("source 未指定时使用 path", () => {
    const path = join(ARTIFACT_DIR, "locomo-full-500-report-phase3-baseline.json");
    const m = loadReportFromFile(path);
    // source 默认 = path (可能含反斜杠)
    const normalized = m.source.replace(/\\/g, "/");
    expect(normalized).toContain("locomo-full-500-report-phase3-baseline.json");
  });
});

describe("loadBaselineReport", () => {
  it("文件不存在 → null", () => {
    const m = loadBaselineReport(ARTIFACT_DIR, "nonexistent.json");
    expect(m).toBeNull();
  });

  it("文件存在 → 返回 metrics, source = baselineName", () => {
    const m = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report-phase3-baseline.json");
    expect(m).not.toBeNull();
    expect(m!.source).toBe("locomo-full-500-report-phase3-baseline.json");
    expect(m!.overallJ).toBeCloseTo(0.452, 6);
  });
});

// === formatRegressionMarkdown ===

describe("formatRegressionMarkdown", () => {
  it("等同 report → 'No regression detected'", () => {
    const baseline = normalizeReportMetrics(legacyReport, "phase3");
    const delta = compareReports(baseline, baseline);
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("## Regression Report:");
    expect(md).toContain("phase3");
    expect(md).toContain("No regression detected");
    expect(md).not.toContain("Regression detected");
  });

  it("回归场景 → 'Regression detected in:'", () => {
    const baseline = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: { temporal: { j_score: 0.5, count: 10 } },
      },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: { temporal: { j_score: 0.3, count: 10 } }, // -0.20
      },
    }, "c");
    const delta = compareReports(baseline, current);
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("⚠️");
    expect(md).toContain("Regression detected in: temporal");
    expect(md).toContain("temporal:");
  });

  it("提升场景 → 'Improved:' 但无 regression", () => {
    const baseline = normalizeReportMetrics(legacyReport, "phase3");
    const current = normalizeReportMetrics(currentReport, "current");
    const delta = compareReports(baseline, current);
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("No regression detected");
    expect(md).toContain("Improved:");
    expect(md).toContain("temporal");
    expect(md).toContain("multi_hop");
  });

  it("包含 overall J delta", () => {
    const baseline = normalizeReportMetrics(legacyReport, "phase3");
    const current = normalizeReportMetrics(currentReport, "current");
    const delta = compareReports(baseline, current);
    const md = formatRegressionMarkdown(delta);
    // +26.60pp
    expect(md).toContain("Overall J delta:");
    expect(md).toContain("+");
    expect(md).toContain("pp");
  });

  it("包含 byCategory delta", () => {
    const baseline = normalizeReportMetrics(legacyReport, "phase3");
    const current = normalizeReportMetrics(currentReport, "current");
    const delta = compareReports(baseline, current);
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("### By Category (J Score delta)");
    expect(md).toContain("temporal:");
    expect(md).toContain("multi_hop:");
    expect(md).toContain("single_hop:");
    expect(md).toContain("open_domain:");
  });

  it("recall5 delta 包含在 markdown 中", () => {
    const baseline = normalizeReportMetrics(legacyReport, "phase3");
    const current = normalizeReportMetrics(currentReport, "current");
    const delta = compareReports(baseline, current);
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("Overall Recall@5 delta:");
  });

  it("context_recall delta 包含在 markdown 中 (新 schema)", () => {
    const baseline = normalizeReportMetrics({
      metrics: { overall: { j_score: 0.5, context_recall: 0.1 } },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: { overall: { j_score: 0.5, context_recall: 0.3 } },
    }, "c");
    const delta = compareReports(baseline, current);
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("Overall ContextRecall delta:");
  });

  it("marker 放置正确 (✅ / ⚠️)", () => {
    const baseline = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { j_score: 0.5, count: 10 },
          multi_hop: { j_score: 0.5, count: 10 },
          single_hop: { j_score: 0.5, count: 10 },
        },
      },
    }, "b");
    const current = normalizeReportMetrics({
      metrics: {
        overall: { j_score: 0.5 },
        byCategory: {
          temporal: { j_score: 0.7, count: 10 }, // +0.20 ✅
          multi_hop: { j_score: 0.3, count: 10 }, // -0.20 ⚠️
          single_hop: { j_score: 0.5, count: 10 }, // 0 无 marker
        },
      },
    }, "c");
    const delta = compareReports(baseline, current);
    const md = formatRegressionMarkdown(delta);
    // temporal 行包含 ✅
    const temporalLine = md.split("\n").find((l) => l.startsWith("- temporal:"));
    expect(temporalLine).toBeDefined();
    expect(temporalLine!).toContain("✅");
    expect(temporalLine!).not.toContain("⚠️");
    // multi_hop 行包含 ⚠️
    const multiHopLine = md.split("\n").find((l) => l.startsWith("- multi_hop:"));
    expect(multiHopLine).toBeDefined();
    expect(multiHopLine!).toContain("⚠️");
    expect(multiHopLine!).not.toContain("✅");
    // single_hop 行无 marker
    const singleHopLine = md.split("\n").find((l) => l.startsWith("- single_hop:"));
    expect(singleHopLine).toBeDefined();
    expect(singleHopLine!).not.toContain("✅");
    expect(singleHopLine!).not.toContain("⚠️");
  });

  it("threshold 显示在 markdown 中", () => {
    const baseline = normalizeReportMetrics(legacyReport, "phase3");
    const delta = compareReports(baseline, baseline, 0.005);
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("threshold: 0.5pp");
  });
});

// === 集成测试: 真实 phase3 → current ===

describe("集成测试: 真实 baseline reports", () => {
  it("phase3 → current: 大幅提升", () => {
    const phase3 = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report-phase3-baseline.json");
    const current = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report.json");
    expect(phase3).not.toBeNull();
    expect(current).not.toBeNull();
    const delta = compareReports(phase3!, current!);
    // overall J: 0.452 → 0.718 = +0.266
    expect(delta.overallJ).toBeCloseTo(0.266, 4);
    expect(delta.hasRegression).toBe(false);
    expect(delta.improvedCategories.length).toBe(4);
    expect(delta.regressedCategories).toEqual([]);
    // markdown 输出
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("## Regression Report:");
    expect(md).toContain("Improved:");
  });

  it("phase3 → phase4: 回归 (历史回归基线)", () => {
    const phase3 = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report-phase3-baseline.json");
    const phase4 = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report-phase4.0-regression.json");
    expect(phase3).not.toBeNull();
    expect(phase4).not.toBeNull();
    const delta = compareReports(phase3!, phase4!);
    // overall J: 0.452 → 0.386 = -0.066 (回归)
    expect(delta.overallJ).toBeCloseTo(-0.066, 4);
    expect(delta.hasRegression).toBe(true);
    expect(delta.regressedCategories.length).toBeGreaterThan(0);
    // markdown 输出包含 ⚠️
    const md = formatRegressionMarkdown(delta);
    expect(md).toContain("⚠️");
    expect(md).toContain("Regression detected in:");
  });

  it("phase4 → current: 大幅提升 (从回归中恢复)", () => {
    const phase4 = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report-phase4.0-regression.json");
    const current = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report.json");
    expect(phase4).not.toBeNull();
    expect(current).not.toBeNull();
    const delta = compareReports(phase4!, current!);
    // overall J: 0.386 → 0.718 = +0.332
    expect(delta.overallJ).toBeCloseTo(0.332, 4);
    expect(delta.hasRegression).toBe(false);
    expect(delta.improvedCategories.length).toBe(4);
  });

  it("完整 pipeline: load → normalize → compare → markdown (无 throw)", () => {
    const phase3 = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report-phase3-baseline.json");
    const phase4 = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report-phase4.0-regression.json");
    const current = loadBaselineReport(ARTIFACT_DIR, "locomo-full-500-report.json");
    const delta1 = compareReports(phase3!, current!);
    const delta2 = compareReports(phase3!, phase4!);
    const md1 = formatRegressionMarkdown(delta1);
    const md2 = formatRegressionMarkdown(delta2);
    expect(md1.length).toBeGreaterThan(100);
    expect(md2.length).toBeGreaterThan(100);
    // 都包含 header
    expect(md1).toContain("## Regression Report:");
    expect(md2).toContain("## Regression Report:");
  });
});
