// WP-E4: Report comparator — 消费 baseline report, 自动 diff, 输出 regressionDelta + markdown 摘要.
//
// Source: 500q 评测代码优化 (WP-E4)
//
// 设计目标:
//   - 消费 artifacts 里的 phase3-baseline / phase4.0-regression / 当前 report
//   - 自动 diff (overall J / category J / recall / context_recall)
//   - 处理两种 schema (旧: jScore/recallAt5 camelCase; 新: j_score/recall_at_5 snake_case)
//   - 输出 regressionDelta (结构化 JSON) + markdown 摘要 (可读)
//
// 约束:
//   - 不修改现有 report schema (只读消费)
//   - 不引入新依赖
//   - 纯函数, 可测试

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// === Schema ===

/**
 * 标准化后的 report metrics (从两种 schema 归一).
 */
export type NormalizedReportMetrics = {
  /** report 来源标识 (文件名或 label) */
  source: string;
  judgeSignature?: string;
  contextRecallDefinition?: string;
  /** report version 字段 */
  version?: string;
  /** 总题数 */
  totalQuestions: number;
  /** overall J Score (0-1) */
  overallJ: number;
  /** overall Recall@5 (0-1, 可选) */
  overallRecall5?: number;
  /** overall Context Recall (0-1, 可选, 旧 report 无此字段) */
  overallContextRecall?: number;
  /** byCategory J Score */
  byCategoryJ: Record<string, number>;
  /** byCategory Recall@5 */
  byCategoryRecall5: Record<string, number>;
  /** byCategory Context Recall (可选) */
  byCategoryContextRecall?: Record<string, number>;
  /** byCategory count */
  byCategoryCount: Record<string, number>;
  /** 生成时间 */
  generatedAt?: string;
};

/**
 * 两个 report 的 diff 结果.
 *
 * delta = current - baseline (正值 = 提升, 负值 = 回归).
 */
export type RegressionDelta = {
  /** baseline 来源 */
  baselineSource: string;
  /** current 来源 */
  currentSource: string;
  /** overall J Score delta (current - baseline) */
  overallJ: number;
  /** overall Recall@5 delta */
  overallRecall5?: number;
  /** overall Context Recall delta */
  overallContextRecall?: number;
  /** byCategory J Score delta */
  byCategoryJ: Record<string, number>;
  /** byCategory Recall@5 delta */
  byCategoryRecall5: Record<string, number>;
  /** 是否存在回归 (任一 category J delta < -threshold) */
  hasRegression: boolean;
  judgeComparable: boolean;
  retrievalRegressedCategories: string[];
  /** 回归的 category 列表 (delta < -threshold) */
  regressedCategories: string[];
  /** 提升的 category 列表 (delta > threshold) */
  improvedCategories: string[];
  /** regression 阈值 (pp, 默认 1.0) */
  threshold: number;
};

// === Schema 归一化 ===

/**
 * 从 report JSON 提取标准化 metrics.
 *
 * 处理两种 schema:
 *   - 旧 (phase3/phase4): byCategory 用 jScore/recallAt5 (camelCase)
 *   - 新 (current): byCategory 用 j_score/recall_at_5 (snake_case)
 *
 * overall 在两种 schema 中都用 j_score/recall_at_5 (snake_case).
 */
export function normalizeReportMetrics(
  report: unknown,
  source: string,
): NormalizedReportMetrics {
  const r = report as Record<string, unknown>;
  const metrics = r.metrics as {
    overall?: Record<string, unknown>;
    byCategory?: Record<string, Record<string, unknown>>;
  };
  const overall = metrics?.overall ?? {};
  const byCategory = metrics?.byCategory ?? {};

  // overall: 两种 schema 都用 snake_case
  const overallJ = asNumber(overall.j_score);
  const overallRecall5 = asOptionalNumber(overall.recall_at_5);
  const overallContextRecall = asOptionalNumber(overall.context_recall);

  // byCategory: 处理 camelCase (旧) 和 snake_case (新)
  const byCategoryJ: Record<string, number> = {};
  const byCategoryRecall5: Record<string, number> = {};
  const byCategoryContextRecall: Record<string, number> = {};
  const byCategoryCount: Record<string, number> = {};

  for (const [cat, m] of Object.entries(byCategory)) {
    // jScore (旧) 或 j_score (新)
    byCategoryJ[cat] = asNumber(m.j_score ?? m.jScore);
    // recallAt5 (旧) 或 recall_at_5 (新)
    const r5 = asOptionalNumber(m.recall_at_5 ?? m.recallAt5);
    if (r5 !== undefined) byCategoryRecall5[cat] = r5;
    // context_recall (仅新 schema 有)
    const cr = asOptionalNumber(m.context_recall);
    if (cr !== undefined) byCategoryContextRecall[cat] = cr;
    byCategoryCount[cat] = asNumber(m.count);
  }

  return {
    source,
    judgeSignature: judgeSignature(r.judgeConfig),
    contextRecallDefinition: typeof (r.metricDefinitions as Record<string, unknown> | undefined)?.context_recall === "string"
      ? (r.metricDefinitions as Record<string, string>).context_recall : undefined,
    version: typeof r.version === "string" ? r.version : undefined,
    totalQuestions: asNumber(r.totalQuestions),
    overallJ,
    ...(overallRecall5 !== undefined ? { overallRecall5 } : {}),
    ...(overallContextRecall !== undefined ? { overallContextRecall } : {}),
    byCategoryJ,
    byCategoryRecall5,
    ...(Object.keys(byCategoryContextRecall).length > 0
      ? { byCategoryContextRecall }
      : {}),
    byCategoryCount,
    ...(typeof r.generatedAt === "string" ? { generatedAt: r.generatedAt } : {}),
  };
}

// === Diff ===

/**
 * 比较两个 report, 返回 regression delta.
 *
 * @param baseline 基线 metrics
 * @param current 当前 metrics
 * @param threshold 回归阈值 (pp, 默认 1.0 = 0.01). delta < -threshold 视为回归.
 * @returns regression delta
 */
export function compareReports(
  baseline: NormalizedReportMetrics,
  current: NormalizedReportMetrics,
  threshold: number = 0.01,
): RegressionDelta {
  const overallJ = current.overallJ - baseline.overallJ;
  const overallRecall5 =
    baseline.overallRecall5 !== undefined && current.overallRecall5 !== undefined
      ? current.overallRecall5 - baseline.overallRecall5
      : undefined;
  const overallContextRecall =
    baseline.contextRecallDefinition !== undefined &&
    baseline.contextRecallDefinition === current.contextRecallDefinition &&
    baseline.overallContextRecall !== undefined &&
    current.overallContextRecall !== undefined
      ? current.overallContextRecall - baseline.overallContextRecall
      : undefined;

  const byCategoryJ: Record<string, number> = {};
  const byCategoryRecall5: Record<string, number> = {};
  const regressedCategories: string[] = [];
  const retrievalRegressedCategories: string[] = [];
  const improvedCategories: string[] = [];

  const allCats = new Set([
    ...Object.keys(baseline.byCategoryJ),
    ...Object.keys(current.byCategoryJ),
    ...Object.keys(baseline.byCategoryRecall5),
    ...Object.keys(current.byCategoryRecall5),
  ]);

  for (const cat of allCats) {
    const baseJ = baseline.byCategoryJ[cat];
    const curJ = current.byCategoryJ[cat];
    if (baseJ !== undefined && curJ !== undefined) {
      const delta = curJ - baseJ;
      byCategoryJ[cat] = delta;
      if (delta < -threshold) {
        regressedCategories.push(cat);
      } else if (delta > threshold) {
        improvedCategories.push(cat);
      }
    }

    const baseR5 = baseline.byCategoryRecall5[cat];
    const curR5 = current.byCategoryRecall5[cat];
    if (baseR5 !== undefined && curR5 !== undefined) {
      byCategoryRecall5[cat] = curR5 - baseR5;
      if (byCategoryRecall5[cat] < -threshold) retrievalRegressedCategories.push(cat);
    }
  }

  return {
    baselineSource: baseline.source,
    currentSource: current.source,
    overallJ,
    ...(overallRecall5 !== undefined ? { overallRecall5 } : {}),
    ...(overallContextRecall !== undefined ? { overallContextRecall } : {}),
    byCategoryJ,
    byCategoryRecall5,
    hasRegression: regressedCategories.length > 0 || retrievalRegressedCategories.length > 0
      || overallJ < -threshold || (overallRecall5 !== undefined && overallRecall5 < -threshold),
    judgeComparable: baseline.judgeSignature !== undefined && baseline.judgeSignature === current.judgeSignature,
    retrievalRegressedCategories,
    regressedCategories: [...new Set([...regressedCategories, ...retrievalRegressedCategories])],
    improvedCategories,
    threshold,
  };
}

// === 文件加载 ===

/**
 * 从文件加载 report 并归一化.
 *
 * @param path report JSON 文件路径
 * @param source 来源标识 (默认用文件名)
 * @returns 归一化 metrics (文件不存在则 throw)
 */
export function loadReportFromFile(
  path: string,
  source?: string,
): NormalizedReportMetrics {
  if (!existsSync(path)) {
    throw new Error(`Report file not found: ${path}`);
  }
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw);
  return normalizeReportMetrics(json, source ?? path);
}

/**
 * 从 artifacts 目录加载 baseline report.
 *
 * @param artifactDir artifacts/runtime-memory-eval 目录
 * @param baselineName baseline 文件名 (不含路径)
 * @returns 归一化 metrics (文件不存在则 null)
 */
export function loadBaselineReport(
  artifactDir: string,
  baselineName: string,
): NormalizedReportMetrics | null {
  const path = join(artifactDir, baselineName);
  if (!existsSync(path)) return null;
  return loadReportFromFile(path, baselineName);
}

// === Markdown 摘要 ===

/**
 * 生成 regression delta 的 markdown 摘要.
 *
 * 输出格式:
 *   ## Regression Report: <current> vs <baseline>
 *
 *   - Overall J: 71.80% → 72.60% (**+0.80pp**)
 *   - multi_hop: 52.08% → 56.30% (**+4.22pp**)
 *   - temporal: 78.67% → 76.00% (**-2.67pp** ⚠️)
 *   ...
 *
 *   - Regressed: temporal (-2.67pp)
 *   - Improved: multi_hop (+4.22pp), open_domain (+1.50pp)
 */
export function formatRegressionMarkdown(delta: RegressionDelta): string {
  const lines: string[] = [];
  lines.push(`## Regression Report: ${delta.currentSource} vs ${delta.baselineSource}`);
  if (!delta.judgeComparable) {
    lines.push("> Different or unknown judge configurations: these are arithmetic differences, not comparable measured gains or a ranking.");
  }
  lines.push("");

  // Overall
  const overallPct = (delta.overallJ * 100).toFixed(2);
  const overallSign = delta.overallJ >= 0 ? "+" : "";
  const overallMarker =
    delta.overallJ < -delta.threshold ? " ⚠️" : delta.overallJ > delta.threshold ? " ✅" : "";
  lines.push(`- Overall J delta: **${overallSign}${overallPct}pp**${overallMarker}`);

  if (delta.overallRecall5 !== undefined) {
    const r5Pct = (delta.overallRecall5 * 100).toFixed(2);
    const r5Sign = delta.overallRecall5 >= 0 ? "+" : "";
    lines.push(`- Overall Recall@5 delta: **${r5Sign}${r5Pct}pp**`);
  }

  if (delta.overallContextRecall !== undefined) {
    const crPct = (delta.overallContextRecall * 100).toFixed(2);
    const crSign = delta.overallContextRecall >= 0 ? "+" : "";
    lines.push(`- Overall ContextRecall delta: **${crSign}${crPct}pp**`);
  }

  lines.push("");

  // byCategory
  lines.push("### By Category (J Score delta)");
  for (const [cat, d] of Object.entries(delta.byCategoryJ).sort()) {
    const pct = (d * 100).toFixed(2);
    const sign = d >= 0 ? "+" : "";
    const marker = d < -delta.threshold ? " ⚠️" : d > delta.threshold ? " ✅" : "";
    lines.push(`- ${cat}: **${sign}${pct}pp**${marker}`);
  }

  lines.push("");

  lines.push("### By Category (retrieval proxy delta; independent of J Score)");
  for (const [cat, value] of Object.entries(delta.byCategoryRecall5).sort()) {
    lines.push(`- ${cat}: **${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}pp**${value < -delta.threshold ? " ⚠️" : ""}`);
  }
  if (delta.retrievalRegressedCategories.length > 0) {
    lines.push(`- Retrieval regression: ${delta.retrievalRegressedCategories.join(", ")}`);
  }

  // Summary
  if (delta.hasRegression) {
    lines.push(
      `### ⚠️ Regression detected in: ${delta.regressedCategories.join(", ")}`,
    );
  } else {
    lines.push(`### ✅ No regression detected (threshold: ${(delta.threshold * 100).toFixed(1)}pp)`);
  }

  if (delta.improvedCategories.length > 0) {
    lines.push(`### Improved: ${delta.improvedCategories.join(", ")}`);
  }

  return lines.join("\n");
}

// === 内部工具 ===

function asNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function asOptionalNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function judgeSignature(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const config = value as Record<string, unknown>;
  if (![config.model, config.promptVersion, config.promptTemplate].every((part) => typeof part === "string" && part.length > 0)
    || typeof config.temperature !== "number") return undefined;
  return JSON.stringify([config.model, config.temperature, config.promptVersion, config.promptTemplate]);
}
