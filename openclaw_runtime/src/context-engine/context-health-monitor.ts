/**
 * B-4: ContextHealthMonitor v1 — deterministic four-dimension health scoring
 * for injected context.
 *
 * The industry blank this fills (per the B-4 analysis): nobody scores *what the
 * model actually sees*. Existing observability counts characters and calls;
 * this module scores the *content* — how much of the turn budget is being
 * dropped, whether a compaction summary kept its required structure, how much
 * of the session goal's language survives into the assembled context, and how
 * much of what was injected is actually new information (novelty).
 *
 * v1 is deliberately deterministic and LLM-free:
 *   - `injectionPressure`  — dropRatio/degradation from the turn ledger.
 *   - `structuralFidelity` — compaction summary section coverage.
 *   - `goalAlignment`      — n-gram coverage of `SessionGoal.objective` in the
 *                            assembled context text.
 *   - `informationNovelty` — 1 - max 8-gram Jaccard overlap against a window of
 *                            previously injected text (the Titans surprise
 *                            metric's computable proxy; see computeNovelty).
 *
 * All four dimensions are pure functions of plain data, so the scorer is
 * trivially testable and usable from any caller. The module also keeps a small
 * in-memory history of scores and can dump an explicit snapshot (mirroring
 * `dcsObservability.writeSoakSnapshot`): never auto-called, no flag, no side
 * effects when left uncalled.
 *
 * This module type-imports the turn ledger types only — there is no runtime
 * dependency on `turn-injection-budget`, so `endTurnInjectionBudget` can call
 * back into it without a module cycle.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ObservabilityScoreItem, ObservabilityScorecard } from "../observability/types.js";
import type { TurnInjectionAccounting } from "./turn-injection-budget.js";

export const CONTEXT_HEALTH_SCHEMA = "context-health/v1" as const;

export type ContextHealthDimensions = {
  /** 0-100; high = the turn's injected context survived the budget intact. */
  injectionPressure: number;
  /** 0-100; high = a compaction summary kept its required structure. */
  structuralFidelity: number;
  /** 0-100; high = the session goal's language survives into the context. */
  goalAlignment: number;
  /** 0-100; high = injected content is mostly new, not repeated noise. */
  informationNovelty: number;
};

export type ContextHealthScore = {
  schema: typeof CONTEXT_HEALTH_SCHEMA;
  turnId?: string;
  generatedAt: string;
  dimensions: ContextHealthDimensions;
  /** 0-100 weighted blend of the dimensions that had data. */
  overall: number;
  /** Human-readable reasons for any dimension below its alert threshold. */
  reasons: string[];
  /**
   * T-C1: dimensions the caller supplied no data for.
   *
   * `dimensions` carries a numeric 100 for these so the Observability scorecard
   * shape stays uniform, but a 100 there means "not measured", not "perfect".
   * Without this list the two are indistinguishable on the scorecard — which is
   * the same defect class as the old `scoreGoalAlignment` no-data-returns-100
   * behaviour, one level up. Consumers that care about the difference must read
   * this list, not just the numbers.
   */
  noDataDimensions: Array<keyof ContextHealthDimensions>;
};

export const CONTEXT_HEALTH_DIMENSION_WEIGHTS = {
  injectionPressure: 0.2,
  structuralFidelity: 0.3,
  goalAlignment: 0.3,
  informationNovelty: 0.2,
} as const;

/**
 * Per-dimension alert thresholds (below = a reason is attached). Mirrors the
 * `should_alert` design: goal drift and compression damage are the two signals
 * an operator should act on; the others are informational.
 */
export const CONTEXT_HEALTH_ALERT_THRESHOLDS: ContextHealthDimensions = {
  injectionPressure: 70,
  structuralFidelity: 70,
  goalAlignment: 70,
  informationNovelty: 50,
};

/** Grade mapping shared with the Observability scorecard surface (≥90 A … <60 F). */
function gradeForScore(score: number): ObservabilityScorecard["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const DIMENSION_LABELS: Record<keyof ContextHealthDimensions, string> = {
  injectionPressure: "Injection Pressure",
  structuralFidelity: "Structural Fidelity",
  goalAlignment: "Goal Alignment",
  informationNovelty: "Information Novelty",
};

/**
 * B-4 v2: project a ContextHealthScore onto the Observability scorecard shape so
 * it flows through the existing `observability.traces` → Electron → UI pipeline
 * unchanged. The synthetic `traceId` (`ctx-health-<turnId>`) distinguishes these
 * cards from real trace-quality cards in the score tab, and never collides with
 * a real trace id.
 */
export function contextHealthScoreToScorecard(
  score: ContextHealthScore,
): ObservabilityScorecard {
  const reasons = score.reasons.length > 0 ? score.reasons.join("; ") : "All dimensions healthy.";
  const items: ObservabilityScoreItem[] = (
    Object.keys(CONTEXT_HEALTH_DIMENSION_WEIGHTS) as Array<keyof ContextHealthDimensions>
  ).map((key) => ({
    id: key,
    label: DIMENSION_LABELS[key],
    score: score.dimensions[key],
    weight: CONTEXT_HEALTH_DIMENSION_WEIGHTS[key],
    reason: reasons,
  }));
  return {
    traceId: `ctx-health-${score.turnId ?? "anon"}`,
    score: score.overall,
    grade: gradeForScore(score.overall),
    items,
  };
}

/**
 * Rolling-window novelty (Titans surprise proxy). Text is normalized and
 * reduced to 8-gram shingles; novelty = 1 - max Jaccard overlap against the
 * prior window. An empty window (no history) scores 1 (fully novel); identical
 * text against itself scores 0. Deterministic, no embedding, no LLM.
 */
export function computeNovelty(text: string, window: readonly string[]): number {
  if (window.length === 0) return 1;
  const a = shingles(text);
  if (a.size === 0) return 1;
  let maxOverlap = 0;
  for (const prior of window) {
    if (typeof prior !== "string" || prior.length === 0) continue;
    const b = shingles(prior);
    if (b.size === 0) continue;
    let intersection = 0;
    for (const shingle of a) {
      if (b.has(shingle)) intersection += 1;
    }
    const union = a.size + b.size - intersection;
    if (union <= 0) continue;
    const jaccard = intersection / union;
    if (jaccard > maxOverlap) maxOverlap = jaccard;
  }
  return 1 - maxOverlap;
}

/**
 * N-gram shingles of `text`, whitespace-normalized. Texts shorter than `n`
 * degrade to a single shingle so they still compare meaningfully.
 *
 * **Script sensitivity (T-C1, measured).** These are *character* n-grams, so the
 * same `n` denotes a different linguistic unit per script:
 *
 * | script | `n=4` window | example |
 * |---|---|---|
 * | CJK (no inter-word spaces) | roughly two words | `损伤检测` = 损伤 + 检测 |
 * | Latin | a sub-word fragment | `deco` from "decouple" |
 *
 * Measured on a matched objective pair: a 15-char Chinese objective yields 12
 * shingles, a 62-char English one yields 57. Goal coverage scores correctly for
 * both (fully retained → 100, dropped → 0), so character n-grams **are**
 * applicable to Chinese and need no separate tokenizer — which matters because
 * §R5 technical-5 forbids adding a tokenizer dependency.
 *
 * The asymmetry runs *against* Latin, not against CJK: common English fragments
 * ("tion", "the ") recur across unrelated text and can inflate coverage, while a
 * 4-character Chinese window is specific enough that a match is meaningful. So
 * CJK is the better-behaved script here, not the degraded one.
 */
export function shingles(text: string, n = 8): Set<string> {
  const normalized = text.replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  if (normalized.length === 0) return out;
  if (normalized.length < n) {
    out.add(normalized);
    return out;
  }
  for (let i = 0; i <= normalized.length - n; i += 1) {
    out.add(normalized.slice(i, i + n));
  }
  return out;
}

/**
 * Injection-pressure dimension: dropRatio 0 → 100, the alert threshold (0.1)
 * → 70, 0.3+ → 0. High drop ratios mean the model is losing injected context,
 * which is exactly the "context rot / dumb zone" signal B-4 targets.
 */
export function scoreInjectionPressure(accounting: TurnInjectionAccounting): number {
  const dropRatio = accounting.dropRatio;
  return Math.round(100 * Math.max(0, Math.min(1, 1 - dropRatio * 3)));
}

/**
 * Structural-fidelity dimension: the share of required summary sections that
 * survived compaction. Callers derive `missingSections` from the compaction
 * safeguard's section audit.
 */
export function scoreStructuralFidelity(
  missingSections: readonly string[],
  totalSections = 5,
): number {
  if (!missingSections || missingSections.length === 0) return 100;
  return Math.round(100 * Math.max(0, 1 - missingSections.length / totalSections));
}

/**
 * Goal-alignment dimension: the 4-gram coverage of `objective` inside the
 * assembled context text.
 *
 * Returns **`undefined` when coverage is not computable** — absent objective,
 * empty context, or an objective that yields no shingles. This is deliberate and
 * is the fix for a real defect: the previous version returned `100` for all
 * three no-data cases, which made "we have no goal to compare against"
 * indistinguishable from "the goal is perfectly retained". A monitor that scores
 * missing data as a perfect result cannot detect the thing it exists to detect.
 *
 * Callers must treat `undefined` as no-data, not as zero: pass it straight to
 * {@link scoreContextHealth}, which excludes absent dimensions from the blend
 * and reports them in `noDataDimensions`.
 *
 * See the CJK note on {@link shingles} for how the 4-gram window behaves across
 * scripts.
 */
export function scoreGoalAlignment(
  objective: string | undefined,
  contextText: string | undefined,
): number | undefined {
  if (!objective || objective.trim().length === 0) return undefined;
  if (!contextText || contextText.length === 0) return undefined;
  const objectiveShingles = shingles(objective, 4);
  if (objectiveShingles.size === 0) return undefined;
  const contextShingles = shingles(contextText, 4);
  let covered = 0;
  for (const shingle of objectiveShingles) {
    if (contextShingles.has(shingle)) covered += 1;
  }
  return Math.round(100 * (covered / objectiveShingles.size));
}

/**
 * Information-novelty dimension: average novelty across injected samples.
 * An empty sample list scores 100 (nothing injected, nothing stale).
 */
export function scoreInformationNovelty(
  samples: readonly { channel: string; novelty: number }[],
): number {
  if (!samples || samples.length === 0) return 100;
  const sum = samples.reduce((total, sample) => total + sample.novelty, 0);
  return Math.round(100 * (sum / samples.length));
}

export type ContextHealthInput = {
  turnId?: string;
  injectionPressure?: number;
  structuralFidelity?: number;
  goalAlignment?: number;
  informationNovelty?: number;
};

/**
 * Score one context health observation. Dimensions left `undefined` are
 * skipped from the weighted blend (present dimensions are re-weighted), so a
 * caller with only the turn ledger can score pressure alone, and a caller with
 * only a compaction summary can score fidelity alone.
 */
export function scoreContextHealth(input: ContextHealthInput): ContextHealthScore {
  const dimensions: ContextHealthDimensions = {
    injectionPressure: input.injectionPressure ?? 100,
    structuralFidelity: input.structuralFidelity ?? 100,
    goalAlignment: input.goalAlignment ?? 100,
    informationNovelty: input.informationNovelty ?? 100,
  };
  const provided = (Object.keys(CONTEXT_HEALTH_DIMENSION_WEIGHTS) as Array<keyof ContextHealthDimensions>)
    .filter((key) => input[key] !== undefined);
  let weighted = 0;
  let weightSum = 0;
  for (const key of provided) {
    weighted += dimensions[key] * CONTEXT_HEALTH_DIMENSION_WEIGHTS[key];
    weightSum += CONTEXT_HEALTH_DIMENSION_WEIGHTS[key];
  }
  const overall = weightSum > 0
    ? Math.round(weighted / weightSum)
    : Math.round(
        (dimensions.injectionPressure * CONTEXT_HEALTH_DIMENSION_WEIGHTS.injectionPressure +
          dimensions.structuralFidelity * CONTEXT_HEALTH_DIMENSION_WEIGHTS.structuralFidelity +
          dimensions.goalAlignment * CONTEXT_HEALTH_DIMENSION_WEIGHTS.goalAlignment +
          dimensions.informationNovelty * CONTEXT_HEALTH_DIMENSION_WEIGHTS.informationNovelty) /
          (CONTEXT_HEALTH_DIMENSION_WEIGHTS.injectionPressure +
            CONTEXT_HEALTH_DIMENSION_WEIGHTS.structuralFidelity +
            CONTEXT_HEALTH_DIMENSION_WEIGHTS.goalAlignment +
            CONTEXT_HEALTH_DIMENSION_WEIGHTS.informationNovelty),
      );

  const reasons: string[] = [];
  if (dimensions.injectionPressure < CONTEXT_HEALTH_ALERT_THRESHOLDS.injectionPressure) {
    reasons.push(
      `INJECTION_PRESSURE: context budget dropping too much context (${dimensions.injectionPressure}/100)`,
    );
  }
  if (dimensions.structuralFidelity < CONTEXT_HEALTH_ALERT_THRESHOLDS.structuralFidelity) {
    reasons.push(
      `STRUCTURE_DAMAGE: compaction summary lost required sections (${dimensions.structuralFidelity}/100)`,
    );
  }
  if (dimensions.goalAlignment < CONTEXT_HEALTH_ALERT_THRESHOLDS.goalAlignment) {
    reasons.push(
      `GOAL_DRIFT: session goal language fading from context (${dimensions.goalAlignment}/100)`,
    );
  }
  if (dimensions.informationNovelty < CONTEXT_HEALTH_ALERT_THRESHOLDS.informationNovelty) {
    reasons.push(
      `CONTEXT_ROT: injected content is mostly stale repeats (${dimensions.informationNovelty}/100)`,
    );
  }

  return {
    schema: CONTEXT_HEALTH_SCHEMA,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    generatedAt: new Date().toISOString(),
    dimensions,
    overall,
    reasons,
    noDataDimensions: (
      Object.keys(CONTEXT_HEALTH_DIMENSION_WEIGHTS) as Array<keyof ContextHealthDimensions>
    ).filter((key) => input[key] === undefined),
  };
}

type HistoryEntry = {
  score: ContextHealthScore;
};

const history = new Map<string, HistoryEntry[]>();
let counter = 0;

/**
 * Record a context health observation into the in-memory registry. Keyed by
 * `turnId` when present, otherwise by an incrementing anonymous key.
 */
export function recordContextHealth(score: ContextHealthScore): void {
  const key = score.turnId ?? `anonymous-${counter++}`;
  const bucket = history.get(key);
  if (bucket) {
    bucket.push({ score });
  } else {
    history.set(key, [{ score }]);
  }
}

/** All recorded scores (copy), for tests and snapshots. */
export function getContextHealthHistory(): ContextHealthScore[] {
  const out: ContextHealthScore[] = [];
  for (const entries of history.values()) {
    for (const entry of entries) {
      out.push(entry.score);
    }
  }
  return out;
}

/**
 * Explicit operator-triggered dump (mirrors `dcsObservability.writeSoakSnapshot`):
 * never auto-called by the runtime, not gated by any flag, does not mutate or
 * reset the registry. Returns the written file path; throws on fs failure.
 */
export function writeContextHealthSnapshot(targetDir: string): {
  path: string;
  schema: string;
  generatedAt: string;
} {
  const dir = String(targetDir);
  if (dir.length === 0) {
    throw new Error("writeContextHealthSnapshot: targetDir must be a non-empty path");
  }
  mkdirSync(dir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[:.]/g, "").replace("T", "-").replace("Z", "");
  const suffix = Math.random().toString(36).slice(2, 8);
  const filePath = join(dir, `context-health-${stamp}-${suffix}.json`);
  const payload = {
    schema: CONTEXT_HEALTH_SCHEMA,
    generatedAt,
    scores: getContextHealthHistory(),
    note: "Context health scores are in-memory only. This file is an explicit operator-triggered dump; it is NOT produced by default runtime behavior and is NOT gated by any flag.",
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { path: filePath, schema: payload.schema, generatedAt };
}

/** Test helper: clear the registry and the anonymous counter. */
export function resetContextHealthForTests(): void {
  history.clear();
  counter = 0;
}
