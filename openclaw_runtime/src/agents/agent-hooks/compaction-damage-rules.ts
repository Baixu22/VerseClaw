/**
 * M5-B2: runtime compaction damage rules — the shadow-only enforcement layer
 * that turns the offline paired-analysis damage catalog (decision_loss /
 * entity_loss / dangling_tool_reference / goal_token_decay) into checks that
 * run on every produced compaction summary *in the running agent*.
 *
 * Deliberately a pure, dependency-free module:
 *   - No LLM, no embedding, no tool calls. Everything is deterministic
 *     keyword/section inspection of the summary text.
 *   - Default mode is `shadow`: audit results are recorded (observability /
 *     diagnostics) but NEVER change the summary or abort the turn. The
 *     post-compaction loop guard already owns hard abort behavior; these rules
 *     own the *content-quality* read that the loop guard cannot see.
 *
 * Shadow-first is the safe on-ramp: damage counts are collected until the
 * paired-eval calibration (scripts/context-compression-eval-runner.mjs
 * --paired-summary) shows real thresholds, at which point a caller may opt into
 * enforcement (`mode: "enforce"`).
 *
 * B-4 bridge: {@link scoreContextHealthFromCompactionAudit} projects the audit
 * verdict onto the ContextHealthMonitor dimensions so a damaged summary lowers
 * the structural-fidelity / goal-alignment scores in the same registry the
 * turn-injection budget feeds — one health number per context surface.
 */
import {
  scoreContextHealth,
  scoreStructuralFidelity,
  type ContextHealthScore,
} from "../../context-engine/context-health-monitor.js";

export const COMPACTION_DAMAGE_SCHEMA = "compaction-damage/v1" as const;

export type CompactionDamageType =
  | "goal_token_decay"
  | "structure_damage"
  | "entity_loss_risk"
  | "actionability_loss";

export type CompactionDamage = {
  type: CompactionDamageType;
  severity: "critical" | "high" | "medium";
  detail: string;
};

export type CompactionDamageAudit = {
  schema: typeof COMPACTION_DAMAGE_SCHEMA;
  summaryLength: number;
  damages: CompactionDamage[];
  /** M5-B2: how many of the required compaction sections are missing (0-5). */
  missingSectionCount: number;
  verdict: "clean" | "suspect";
  mode: "shadow" | "enforce";
};

/**
 * Required compaction summary sections (mirrors the compaction safeguard's
 * structural contract; kept here so the damage rules are self-contained).
 */
export const REQUIRED_COMPACTION_SECTIONS = [
  "## Decisions",
  "## Open TODOs",
  "## Constraints/Rules",
  "## Pending user asks",
  "## Exact identifiers",
] as const;

/**
 * Goal-anchoring markers whose total absence signals goal-token decay.
 * Matched as line/heading-level anchors (`## Goal and Progress`, `## Decisions`,
 * `## Key Decisions`, `## Constraints`, `GOAL:` ...) so ordinary prose words
 * like "decision" in a sentence do not count as surviving goal language.
 */
const GOAL_ANCHOR_PATTERN = /(?:^|\n)(?:#{1,6}\s*)?(?:GOAL|OBJECTIVE|DECISIONS?|CONSTRAINTS?|Goal and Progress|Key Decisions|Next Actions|目标|决策|约束)\b/i;

/** Action verbs whose absence signals the summary is not actionable. */
const ACTION_VERBS = [
  "edit",
  "write",
  "fix",
  "implement",
  "refactor",
  "add",
  "remove",
  "test",
  "verify",
  "run",
  "update",
  "replace",
  "迁移",
  "重构",
  "实现",
  "修复",
  "添加",
  "删除",
] as const;

/**
 * Identifier-like tokens whose total absence signals entity loss. Only path/
 * extension forms and camelCase words (lowercase-first) count — PascalCase
 * words like section headings (Progress, Decisions) would otherwise create
 * false positives.
 */
const IDENTIFIER_LIKE_PATTERN = /[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|go|rs|java|css|md|vue|svelte)\b|\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]+\b/g;

/**
 * Audit a produced compaction summary against the damage catalog. In `shadow`
 * mode the verdict is informational only — callers must not change behavior on
 * it; in `enforce` mode callers may alert/retry (never silently alter).
 */
export function auditCompactionDamage(
  summary: string,
  options: { mode?: "shadow" | "enforce" } = {},
): CompactionDamageAudit {
  const mode = options.mode ?? "shadow";
  const damages: CompactionDamage[] = [];
  const text = summary ?? "";
  const lower = text.toLowerCase();

  // 1. goal_token_decay: no line/heading-level goal anchor survived.
  if (!GOAL_ANCHOR_PATTERN.test(lower)) {
    damages.push({
      type: "goal_token_decay",
      severity: "critical",
      detail: "No goal/objective/decision markers survive the summary.",
    });
  }

  // 2. structure_damage: required sections missing.
  const missingSections = REQUIRED_COMPACTION_SECTIONS.filter(
    (section) => !text.includes(section),
  );
  if (missingSections.length > 0) {
    damages.push({
      type: "structure_damage",
      severity: missingSections.length >= 3 ? "high" : "medium",
      detail: `Missing sections: ${missingSections.join(", ")}`,
    });
  }

  // 3. entity_loss_risk: no identifier-like tokens (paths/symbols) survived.
  const identifierCount = (text.match(IDENTIFIER_LIKE_PATTERN) ?? []).length;
  if (identifierCount === 0) {
    damages.push({
      type: "entity_loss_risk",
      severity: "high",
      detail: "No identifier-like tokens (paths/symbols) survive the summary.",
    });
  }

  // 4. actionability_loss: no actionable verb survived.
  if (!ACTION_VERBS.some((verb) => lower.includes(verb))) {
    damages.push({
      type: "actionability_loss",
      severity: "medium",
      detail: "Summary contains no actionable verbs; the model may not know what to do next.",
    });
  }

  return {
    schema: COMPACTION_DAMAGE_SCHEMA,
    summaryLength: text.length,
    damages,
    missingSectionCount: missingSections.length,
    verdict: damages.length > 0 ? "suspect" : "clean",
    mode,
  };
}

/**
 * B-4 bridge (M5 calibration): project a compaction damage audit onto the
 * ContextHealthMonitor dimensions.
 *
 *   - structuralFidelity ← REQUIRED_COMPACTION_SECTIONS coverage (missing
 *     section count drives the score down via scoreStructuralFidelity).
 *   - goalAlignment      ← goal_token_decay forces a low score (30) when no
 *     goal anchor survived; otherwise 100.
 *   - injectionPressure  ← unchanged (100) — this is a content audit, not a
 *     budget audit; the turn ledger scores that dimension separately.
 *   - informationNovelty ← unchanged (100) — novelty is scored on injection
 *     windows, not on a single summary.
 *
 * The damage `detail` strings ride as the scorecard reasons so the Observability
 * score tab explains WHY the score dropped.
 */
export function scoreContextHealthFromCompactionAudit(
  audit: CompactionDamageAudit,
): ContextHealthScore {
  const missingSectionCount = audit.missingSectionCount;
  const structuralFidelity =
    missingSectionCount > 0
      ? scoreStructuralFidelity(Array(missingSectionCount).fill("missing"))
      : 100;
  const goalDecayed = audit.damages.some((damage) => damage.type === "goal_token_decay");
  const goalAlignment = goalDecayed ? 30 : 100;
  return scoreContextHealth({
    structuralFidelity,
    goalAlignment,
  });
}
