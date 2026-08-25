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
  scoreGoalAlignment,
  scoreStructuralFidelity,
  type ContextHealthScore,
} from "../../context-engine/context-health-monitor.js";
import { isContextEnhancementKillSwitchEngaged } from "../../context-engine/enhancement-kill-switch.js";
import {
  REQUIRED_COMPACTION_SECTIONS,
  hasSubstantiveSectionContent,
  stripRequiredSectionHeadings,
} from "./compaction-sections.js";

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
 * Required compaction summary sections. Re-exported from the shared source
 * (`compaction-sections.ts`) so this module's public API is unchanged while the
 * list itself is no longer duplicated against `compaction-safeguard-quality.ts`.
 */
export { REQUIRED_COMPACTION_SECTIONS } from "./compaction-sections.js";

/**
 * Goal-anchoring markers whose presence is positive evidence that goal language
 * survived. Matched at line/heading position so ordinary prose words like
 * "decision" mid-sentence do not count.
 *
 * Split by script on purpose. `\b` is defined over `[A-Za-z0-9_]`, so a trailing
 * `\b` after a CJK character never matches — there is no word boundary between
 * `标` and `：` because neither is a word character. The previous single pattern
 * put `目标|决策|约束` in front of a shared `\b` and those three alternatives were
 * therefore **dead from the day they were written**: measured, `目标：完成迁移`,
 * `## 目标` and `决策：保留旧 kid` all failed to match while `GOAL: ship it`
 * matched. That is the §R1 A5 defect class (CJK-hostile matching that survives
 * because the tests are all English), so the CJK alternatives now carry no `\b`.
 */
const GOAL_ANCHOR_PATTERN_ASCII =
  /(?:^|\n)(?:#{1,6}\s*)?(?:GOAL|OBJECTIVE|DECISIONS?|CONSTRAINTS?|Goal and Progress|Key Decisions|Next Actions)\b/i;
const GOAL_ANCHOR_PATTERN_CJK = /(?:^|\n)(?:#{1,6}\s*)?(?:目标|决策|约束|目的)/u;

/** True when a line/heading-position goal anchor is present, in either script. */
function hasGoalAnchor(text: string): boolean {
  return GOAL_ANCHOR_PATTERN_ASCII.test(text) || GOAL_ANCHOR_PATTERN_CJK.test(text);
}

/**
 * Minimum share of the objective's 4-gram shingles that must survive into the
 * summary for the goal to count as retained, when an objective is supplied.
 *
 * Chosen to sit below the health monitor's `goalAlignment` alert threshold (70)
 * so the binary damage flag fires no *later* than the graded dimension warns:
 * a summary can be flagged as drifting before it is flagged as decayed.
 */
export const GOAL_RETENTION_MIN_COVERAGE = 0.2;

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
 * Decide whether the session goal survived the summary.
 *
 * Three paths, in preference order:
 *
 * 1. **Objective coverage (preferred).** When the caller knows the session
 *    objective, measure 4-gram coverage of the objective's own text inside the
 *    summary. Orthogonal to the section contract by construction: it asks "is
 *    the goal's language still here", not "is there a heading named like a goal".
 * 2. **Explicit goal anchor.** A goal anchor at line position in the
 *    heading-stripped text — `## Goal and Progress`, `GOAL:`, `目标：`. Stripping
 *    the *required* headings first is what keeps this orthogonal: `## Decisions`
 *    is a template artifact, not goal evidence.
 * 3. **Substantive section content.** A compliant summary's only sections are the
 *    required five, so after stripping them path 2 has nothing left to match —
 *    which would flag every compliant summary. The real signal is whether those
 *    sections have *bodies*: `## Decisions\nRotated the JWT key` retained the
 *    goal, `## Decisions\nNone.` did not.
 *
 * Path 3 is why this is a content check rather than a template check, and it is
 * the path that makes the hollowed-summary case fail correctly.
 */
function detectGoalRetention(
  text: string,
  objective: string | undefined,
): {
  retained: boolean;
  basis: "objective-coverage" | "goal-anchor" | "section-content";
  coverage?: number;
} {
  const trimmedObjective = objective?.trim() ?? "";
  if (trimmedObjective.length > 0) {
    const coverage = goalShingleCoverage(trimmedObjective, text);
    if (coverage !== undefined) {
      return {
        retained: coverage >= GOAL_RETENTION_MIN_COVERAGE,
        basis: "objective-coverage",
        coverage,
      };
    }
  }
  const contentOnly = stripRequiredSectionHeadings(text);
  if (hasGoalAnchor(contentOnly)) {
    return { retained: true, basis: "goal-anchor" };
  }
  return { retained: hasSubstantiveSectionContent(text), basis: "section-content" };
}

/**
 * Share of the objective's 4-gram shingles present in `text`, as a 0..1 ratio,
 * or undefined when coverage is not computable.
 *
 * Delegates to {@link scoreGoalAlignment} rather than reimplementing the n-gram
 * maths: requirement-1 points at it as the existing implementation, it already
 * returns `undefined` for the no-data cases, and its CJK behaviour is documented
 * and measured there. Reusing it also means the graded `goalAlignment` dimension
 * and this binary damage flag can never disagree about what coverage a summary
 * has — they are the same computation with different thresholds.
 */
function goalShingleCoverage(objective: string, text: string): number | undefined {
  const score = scoreGoalAlignment(objective, text);
  return score === undefined ? undefined : score / 100;
}

/**
 * Env gate for the shadow damage audit. **Default off.**
 *
 * Deliberately env-only rather than a new config leaf: a config leaf would have
 * to be declared across `zod-schema.ts` / `types.openclaw.ts` /
 * `runtime-feature-leaves.ts` / the ops catalog to satisfy §R1 A4, and all four
 * are the other lane's exclusive files this round. TF-0128 requirement-8
 * explicitly allows reusing existing gating instead of adding a flag, so this
 * gate is one env var plus the existing enhancement kill switch.
 */
export const COMPACTION_DAMAGE_AUDIT_ENV = "OPENCLAW_COMPACTION_DAMAGE_AUDIT";

/**
 * Whether the shadow damage audit should run.
 *
 * Fail-closed in both directions: unset/unparseable env means off, and an
 * engaged enhancement kill switch overrides an explicit opt-in. When this returns
 * false the caller must not audit, must not score, and must not write anything —
 * behaviour is byte-identical to before this task (see the AC-7 test).
 */
export function isCompactionDamageAuditEnabled(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    if (isContextEnhancementKillSwitchEngaged(cfg, env)) return false;
    const raw = env[COMPACTION_DAMAGE_AUDIT_ENV]?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  } catch {
    // Never let a gate evaluation break a compaction turn.
    return false;
  }
}

/**
 * Audit a produced compaction summary against the damage catalog. In `shadow`
 * mode the verdict is informational only — callers must not change behavior on
 * it; in `enforce` mode callers may alert/retry (never silently alter).
 *
 * Pass `objective` (the session goal text) whenever it is available: it switches
 * goal-decay detection from the fallback paths to direct objective coverage,
 * which is both stricter and independent of the section contract.
 */
export function auditCompactionDamage(
  summary: string,
  options: { mode?: "shadow" | "enforce"; objective?: string } = {},
): CompactionDamageAudit {
  const mode = options.mode ?? "shadow";
  const damages: CompactionDamage[] = [];
  const text = summary ?? "";
  const lower = text.toLowerCase();

  // 1. goal_token_decay: the session goal did not survive the summary.
  //    Deliberately computed on heading-stripped text (or against the objective
  //    itself) so a structurally-complete but hollow summary still fails.
  const goal = detectGoalRetention(text, options.objective);
  if (!goal.retained) {
    damages.push({
      type: "goal_token_decay",
      severity: "critical",
      detail:
        goal.basis === "objective-coverage"
          ? `Session objective barely survives the summary (4-gram coverage ${(
              (goal.coverage ?? 0) * 100
            ).toFixed(1)}% < ${(GOAL_RETENTION_MIN_COVERAGE * 100).toFixed(0)}%).`
          : "No goal anchor and no substantive section content survive the summary; required section headings alone are not goal evidence.",
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
