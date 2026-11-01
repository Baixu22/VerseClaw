/**
 * Session start injection plan — one plan for every start-of-session source.
 *
 * Today a session start can be fed by four owners that never see each other:
 * startup memory files, the long-session continuity pack, a handoff draft, and
 * inherited fork context. Each carries its own budget and its own diagnostics,
 * so "why did this session start with this text" has no single answer.
 *
 * This module produces that single answer as a plan. It is deliberately
 * shadow-only: it decides what *would* be included, in what order, within what
 * budget, and why the rest is dropped — and it hands nobody a prompt. Nothing
 * here is wired into assembly, so a turn's real prompt stays byte-identical to
 * whatever it was before this plan existed.
 *
 * The plan is also the baseline for the later wiring step: when that step lands,
 * "flag-off parity" means "the prompt still equals what this plan would not
 * have changed".
 */
export const SESSION_START_INJECTION_SCHEMA = 'SessionStartInjectionPlan/v1' as const;

/**
 * The owners that can contribute start-of-session context.
 *
 * Every value names an owner that already exists. The plan does not create a
 * source; it only ranks the ones present.
 */
export type SessionStartSourceId =
  | 'startup-memory'
  | 'continuity-pack'
  | 'handoff-draft'
  | 'fork-inheritance';

export const SESSION_START_SOURCE_IDS: readonly SessionStartSourceId[] = [
  'startup-memory',
  'continuity-pack',
  'handoff-draft',
  'fork-inheritance',
] as const;

/**
 * Fixed precedence. Correctness-bearing context first, convenience last.
 *
 * This ordering is the plan's contract: a later source is the one that loses
 * budget when the total runs out. It is intentionally identical in spirit to the
 * turn-injection precedence so operators do not have to learn a second ladder.
 */
export const SESSION_START_PRECEDENCE: readonly SessionStartSourceId[] = [
  'continuity-pack',
  'handoff-draft',
  'startup-memory',
  'fork-inheritance',
] as const;

/** Default character budget for a whole start-of-session plan. */
export const DEFAULT_SESSION_START_BUDGET_CHARS = 2_800;

export type SessionStartSourceFact = {
  sourceId: SessionStartSourceId;
  /** Whether the owner says it has content for this session. */
  available: boolean;
  /** Characters the owner would contribute if included. */
  chars: number;
  /** Owner-level note that must survive into the plan (for example a stale read). */
  detail?: string;
};

export type SessionStartPlanItem = {
  sourceId: SessionStartSourceId;
  included: boolean;
  charsRequested: number;
  charsApplied: number;
  /** Why this source ended up included or excluded. */
  reason:
    | 'applied'
    | 'not-available'
    | 'empty'
    | 'stage-excluded'
    | 'budget-drop'
    | 'budget-partial'
    | 'fail-closed-unknown-stage';
  detail?: string;
};

export type SessionStartInjectionPlan = {
  schema: typeof SESSION_START_INJECTION_SCHEMA;
  sessionKey?: string;
  /** Stage the plan was built for; the stage projection owns the value. */
  stage: string;
  budgetChars: number;
  charsApplied: number;
  charsRemaining: number;
  items: SessionStartPlanItem[];
  /** True when the plan would have contributed nothing at all. */
  empty: boolean;
  /** Sources the stage never consults, recorded so the omission is visible. */
  stageExcluded: SessionStartSourceId[];
};

export type BuildSessionStartInjectionPlanInput = {
  sessionKey?: string | null;
  /** Session stage from the read-only stage projection. */
  stage: string | null | undefined;
  facts: readonly SessionStartSourceFact[];
  /** Total character budget; defaults to DEFAULT_SESSION_START_BUDGET_CHARS. */
  budgetChars?: number;
};

/**
 * Which sources a stage is allowed to consult.
 *
 * `continued` is the normal middle of a session: it already has history, so it
 * gets no start-of-session plan at all. `unknown` is fail-closed on purpose —
 * when the stage cannot be proven, injecting is the riskier error.
 */
const STAGE_SOURCES: Record<string, readonly SessionStartSourceId[]> = {
  fresh: ['startup-memory', 'continuity-pack'],
  compacted: ['continuity-pack', 'startup-memory'],
  restored: ['continuity-pack', 'startup-memory'],
  resumed: ['continuity-pack'],
  forked: ['continuity-pack', 'fork-inheritance'],
  handedOff: ['continuity-pack', 'handoff-draft'],
  continued: [],
  unknown: [],
};

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Build one start-of-session plan.
 *
 * Pure: same input, same plan. No clock, no I/O, no store. The function never
 * mutates `facts`.
 */
export function buildSessionStartInjectionPlan(
  input: BuildSessionStartInjectionPlanInput,
): SessionStartInjectionPlan {
  const stage = typeof input.stage === 'string' && input.stage.trim() ? input.stage.trim() : 'unknown';
  const budgetChars = nonNegativeInt(input.budgetChars) || DEFAULT_SESSION_START_BUDGET_CHARS;
  const allowed = STAGE_SOURCES[stage] ?? [];

  const stageExcluded = SESSION_START_SOURCE_IDS.filter((id) => !allowed.includes(id));
  const items: SessionStartPlanItem[] = [];

  const factById = new Map<SessionStartSourceId, SessionStartSourceFact>();
  for (const fact of input.facts) factById.set(fact.sourceId, fact);

  // Fail-closed: an unproven stage never yields a plan, even if facts exist.
  if (allowed.length === 0) {
    for (const sourceId of SESSION_START_SOURCE_IDS) {
      const fact = factById.get(sourceId);
      items.push({
        sourceId,
        included: false,
        charsRequested: nonNegativeInt(fact?.chars),
        charsApplied: 0,
        reason: stage === 'unknown' ? 'fail-closed-unknown-stage' : 'stage-excluded',
        ...(fact?.detail ? { detail: fact.detail } : {}),
      });
    }
    return {
      schema: SESSION_START_INJECTION_SCHEMA,
      ...(typeof input.sessionKey === 'string' && input.sessionKey.trim()
        ? { sessionKey: input.sessionKey.trim() }
        : {}),
      stage,
      budgetChars,
      charsApplied: 0,
      charsRemaining: budgetChars,
      items,
      empty: true,
      stageExcluded,
    };
  }

  let remaining = budgetChars;
  const applied = new Map<SessionStartSourceId, number>();

  for (const sourceId of SESSION_START_PRECEDENCE) {
    const fact = factById.get(sourceId);
    const requested = nonNegativeInt(fact?.chars);

    if (!allowed.includes(sourceId)) {
      items.push({
        sourceId,
        included: false,
        charsRequested: requested,
        charsApplied: 0,
        reason: 'stage-excluded',
        ...(fact?.detail ? { detail: fact.detail } : {}),
      });
      continue;
    }
    if (!fact || fact.available !== true) {
      items.push({
        sourceId,
        included: false,
        charsRequested: requested,
        charsApplied: 0,
        reason: 'not-available',
        ...(fact?.detail ? { detail: fact.detail } : {}),
      });
      continue;
    }
    if (requested === 0) {
      items.push({
        sourceId,
        included: false,
        charsRequested: 0,
        charsApplied: 0,
        reason: 'empty',
        ...(fact.detail ? { detail: fact.detail } : {}),
      });
      continue;
    }
    if (remaining <= 0) {
      items.push({
        sourceId,
        included: false,
        charsRequested: requested,
        charsApplied: 0,
        reason: 'budget-drop',
        detail: `${requested} chars requested with 0 remaining${fact.detail ? `; ${fact.detail}` : ''}`,
      });
      continue;
    }
    if (requested <= remaining) {
      items.push({
        sourceId,
        included: true,
        charsRequested: requested,
        charsApplied: requested,
        reason: 'applied',
        ...(fact.detail ? { detail: fact.detail } : {}),
      });
      applied.set(sourceId, requested);
      remaining -= requested;
      continue;
    }
    // Partial is a first-class outcome: the reader must see it was cut, and by
    // how much, rather than discovering a silently short section later.
    items.push({
      sourceId,
      included: true,
      charsRequested: requested,
      charsApplied: remaining,
      reason: 'budget-partial',
      detail: `truncated ${requested - remaining} chars by budget${fact.detail ? `; ${fact.detail}` : ''}`,
    });
    applied.set(sourceId, remaining);
    remaining = 0;
  }

  const charsApplied = budgetChars - remaining;
  return {
    schema: SESSION_START_INJECTION_SCHEMA,
    ...(typeof input.sessionKey === 'string' && input.sessionKey.trim()
      ? { sessionKey: input.sessionKey.trim() }
      : {}),
    stage,
    budgetChars,
    charsApplied,
    charsRemaining: remaining,
    items,
    empty: charsApplied === 0,
    stageExcluded,
  };
}
