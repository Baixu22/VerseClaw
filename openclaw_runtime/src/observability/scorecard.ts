import type {
  ObservabilityScoreItem,
  ObservabilityScorecard,
  ObservabilityTrace,
} from "./types.js";
import { aggregateTraceMetrics } from "./metrics.js";

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function grade(score: number): ObservabilityScorecard["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function item(id: string, label: string, score: number, weight: number, reason: string): ObservabilityScoreItem {
  return { id, label, score: clampScore(score), weight, reason };
}

export function buildTraceScorecard(trace: ObservabilityTrace): ObservabilityScorecard {
  const metrics = aggregateTraceMetrics(trace);
  const reliability = metrics.errorCount === 0 ? 100 : Math.max(0, 100 - metrics.errorCount * 25);
  const verifierExpected = trace.mode === "adversarial-review";
  const verification = verifierExpected ? (metrics.verifierCount > 0 ? 100 : 20) : 85;
  const contextPack = trace.tags.includes("role-first") ? (metrics.contextPackCount > 0 ? 100 : 40) : 85;
  const cost = metrics.costUsd <= 0.25 ? 100 : metrics.costUsd <= 1 ? 80 : metrics.costUsd <= 5 ? 60 : 30;
  const latency = metrics.durationMs <= 10_000 ? 100 : metrics.durationMs <= 60_000 ? 80 : metrics.durationMs <= 180_000 ? 60 : 35;
  const items = [
    item("reliability", "Reliability", reliability, 0.3, metrics.errorCount === 0 ? "No trace/span errors." : `${metrics.errorCount} error(s) found.`),
    item("verification", "Verification", verification, 0.25, verifierExpected ? "Adversarial traces require verifier/skeptic evidence." : "Non-adversarial trace uses baseline verification score."),
    item("context", "Context Discipline", contextPack, 0.2, trace.tags.includes("role-first") ? "Role-first traces should include context-pack budgeting." : "Context pack optional for non-role traces."),
    item("cost", "Cost Control", cost, 0.15, `Cost $${metrics.costUsd.toFixed(6)}.`),
    item("latency", "Latency", latency, 0.1, `Duration ${metrics.durationMs}ms.`),
  ];
  const score = clampScore(items.reduce((sum, scoreItem) => sum + scoreItem.score * scoreItem.weight, 0));
  return { traceId: trace.id, score, grade: grade(score), items };
}
