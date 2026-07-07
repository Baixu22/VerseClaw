// Report generator for runtime-memory long conversation evaluation.
// Pure functions only — no vitest imports. Takes a MultiTurnRunResult and
// produces a structured report plus markdown formatting.

import type { MultiTurnRunResult, ArmMetrics } from "../../../openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.js";
import {
  bootstrapConfidenceInterval,
  cohensD,
  mean,
  minimumSampleSize,
  pairedTTest,
  type BootstrapCIResult,
  type PairedTTestResult,
} from "../../../openclaw_runtime/src/agents/runtime-memory-eval/statistics.js";

export type LongConversationReport = {
  generatedAt: number;
  turns: number;
  queriesPerTurn: number;
  totalDurationMs: number;
  metrics: ReadonlyArray<{
    metric: string;
    baselineMean: number;
    baselineP50: number;
    baselineP95: number;
    treatmentMean: number;
    treatmentP50: number;
    treatmentP95: number;
    delta: number;
  }>;
  statistics: {
    pairedTTest: PairedTTestResult;
    bootstrapCI: BootstrapCIResult;
    cohensD: number;
    minimumSampleSize: number;
  };
  conclusion: {
    significant: boolean;
    effectSizeLabel: "negligible" | "small" | "medium" | "large";
    achieved: boolean;
  };
};

const ARM_METRIC_KEYS: ReadonlyArray<keyof ArmMetrics> = [
  "recallAtK",
  "precision",
  "latencyMs",
  "tokenOverhead",
  "rawLeakRate",
  "promptInjectionReturnRate",
  "acceptedFactCount",
  "rejectedFactCount",
];

const DEFAULT_SEED = 0x1a2b3c4d;
const DEFAULT_NOW = () => Date.now();

export function generateLongConversationReport(
  result: MultiTurnRunResult,
  options?: { now?: () => number; seed?: number },
): LongConversationReport {
  const now = options?.now ?? DEFAULT_NOW;
  const seed = options?.seed ?? DEFAULT_SEED;

  const baselineRecalls = result.turns.map((t) => t.baseline.recallAtK);
  const treatmentRecalls = result.turns.map((t) => t.treatment.recallAtK);

  const tTest = pairedTTest(baselineRecalls, treatmentRecalls);
  const bootCI = bootstrapConfidenceInterval(treatmentRecalls, { seed });
  const d = cohensD(baselineRecalls, treatmentRecalls);
  const requiredN = minimumSampleSize(d, 0.05, 0.8);

  const metrics = ARM_METRIC_KEYS.map((key) => {
    const b = result.aggregateBaseline[key];
    const t = result.aggregateTreatment[key];
    return {
      metric: key,
      baselineMean: b.mean,
      baselineP50: b.p50,
      baselineP95: b.p95,
      treatmentMean: t.mean,
      treatmentP50: t.p50,
      treatmentP95: t.p95,
      delta: t.mean - b.mean,
    };
  });

  const effectSizeLabel = labelEffectSize(d);
  const baselineMeanRecall = mean(baselineRecalls);
  const achieved = tTest.significant && bootCI.lower > baselineMeanRecall && requiredN <= result.turnCount;

  return {
    generatedAt: now(),
    turns: result.turnCount,
    queriesPerTurn: result.queriesPerTurn,
    totalDurationMs: result.totalDurationMs,
    metrics,
    statistics: {
      pairedTTest: tTest,
      bootstrapCI: bootCI,
      cohensD: d,
      minimumSampleSize: requiredN,
    },
    conclusion: {
      significant: tTest.significant,
      effectSizeLabel,
      achieved,
    },
  };
}

function labelEffectSize(d: number): "negligible" | "small" | "medium" | "large" {
  const absD = Math.abs(d);
  if (absD < 0.2) return "negligible";
  if (absD < 0.5) return "small";
  if (absD < 0.8) return "medium";
  return "large";
}

export function formatReportAsMarkdown(report: LongConversationReport): string {
  const lines: string[] = [];
  lines.push("# Runtime Memory Long Conversation Evaluation Report");
  lines.push("");
  lines.push(`- Generated at: ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`- Turns: ${report.turns}`);
  lines.push(`- Queries per turn: ${report.queriesPerTurn}`);
  lines.push(`- Total duration: ${report.totalDurationMs.toFixed(2)} ms`);
  lines.push("");

  lines.push("## Per-Metric Comparison");
  lines.push("");
  lines.push("| Metric | Baseline Mean | Baseline P50 | Baseline P95 | Treatment Mean | Treatment P50 | Treatment P95 | Delta |");
  lines.push("|--------|---------------|--------------|--------------|----------------|---------------|---------------|-------|");
  for (const m of report.metrics) {
    lines.push(
      `| ${m.metric} | ${m.baselineMean.toFixed(4)} | ${m.baselineP50.toFixed(4)} | ${m.baselineP95.toFixed(4)} | ${m.treatmentMean.toFixed(4)} | ${m.treatmentP50.toFixed(4)} | ${m.treatmentP95.toFixed(4)} | ${m.delta.toFixed(4)} |`,
    );
  }
  lines.push("");

  const st = report.statistics;
  lines.push("## Statistical Analysis (recall@k)");
  lines.push("");
  lines.push("| Test | Value |");
  lines.push("|------|-------|");
  lines.push(`| Paired t-test t | ${st.pairedTTest.t.toFixed(4)} |`);
  lines.push(`| Paired t-test df | ${st.pairedTTest.df} |`);
  lines.push(`| Paired t-test p-value | ${st.pairedTTest.pValue.toFixed(4)} |`);
  lines.push(`| Paired t-test mean diff | ${st.pairedTTest.meanDiff.toFixed(4)} |`);
  lines.push(`| Paired t-test significant | ${st.pairedTTest.significant} |`);
  lines.push(`| Bootstrap CI mean | ${st.bootstrapCI.mean.toFixed(4)} |`);
  lines.push(`| Bootstrap CI lower | ${st.bootstrapCI.lower.toFixed(4)} |`);
  lines.push(`| Bootstrap CI upper | ${st.bootstrapCI.upper.toFixed(4)} |`);
  lines.push(`| Cohen's d | ${st.cohensD.toFixed(4)} |`);
  lines.push(`| Minimum sample size | ${st.minimumSampleSize} |`);
  lines.push("");

  lines.push("## Conclusion");
  lines.push("");
  lines.push(`- Significant: ${report.conclusion.significant}`);
  lines.push(`- Effect size: ${report.conclusion.effectSizeLabel}`);
  lines.push(`- Achieved: ${report.conclusion.achieved}`);
  lines.push("");

  return lines.join("\n");
}
