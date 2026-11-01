/**
 * A2b: the one place a start-of-session plan becomes an injection.
 *
 * A2a answered "what would this session start with". This module answers the
 * follow-up question production needs: turn that plan into `ContextCandidate/v1`
 * entries on the `session_start` channel so the existing orchestrator does the
 * deduplication, ledger charge, budgeting, projection, and lineage - rather than
 * a fourth injection path growing its own budget next to the user body.
 *
 * Two invariants hold here and are covered by tests:
 *  - flag off means no candidate and no charge at all (byte-identical prompt),
 *  - the injected text is exactly the plan's `charsApplied` prefix, so the plan
 *    and the prompt cannot disagree about a partial injection.
 */
import {
  SESSION_START_CHANNEL_SOURCE_ID,
  buildSessionStartInjectionPlan,
  type SessionStartInjectionPlan,
  type SessionStartInjectionRequest,
  type SessionStartSourceId,
} from "../../../shared/types/session-start-injection.js";
import {
  collectContextCandidate,
  createContextCandidate,
  recordContextCandidateSkip,
  type ContextCandidate,
} from "./context-candidate.js";
import type { TurnInjectionChannel } from "./turn-injection-budget.js";

/** The channel every start-of-session candidate is charged to. */
export const SESSION_START_INJECTION_CHANNEL: TurnInjectionChannel = "session_start";

/**
 * Env override. The config leaf stays the durable switch; this only lets an
 * operator prove the flag-on path without editing a config file.
 */
export const SESSION_START_INJECTION_ENV = "VERSE_SESSION_START_INJECTION";

export type SessionStartInjectionConfig = {
  enabled: boolean;
  /** Plan character budget when the config names one. */
  budgetChars?: number;
};

export type SessionStartInjectionOutcome = {
  /** True when at least one candidate was collected for this turn. */
  applied: boolean;
  reason: "applied" | "flag-off" | "empty";
  /** The plan the turn was decided on; null when the flag was off. */
  plan: SessionStartInjectionPlan | null;
  candidates: ContextCandidate[];
  charsApplied: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function envTruthy(raw: string | undefined): boolean | null {
  if (raw == null || raw.trim() === "") return null;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return null;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

/**
 * Resolve the session-start injection switch.
 *
 * Fail-closed: any unreadable config shape or throwing getter resolves to
 * "disabled" rather than throwing into the turn. The enhancement kill switch is
 * a separate, stricter gate evaluated by the orchestrator.
 */
export function resolveSessionStartInjectionConfig(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): SessionStartInjectionConfig {
  try {
    const fromEnv = envTruthy(env[SESSION_START_INJECTION_ENV]);
    const record = asRecord(cfg);
    const runtime = asRecord(record?.runtime) ?? record;
    const leaf = asRecord(asRecord(runtime?.contextBlock)?.sessionStartInjection);
    const budgetChars = positiveInt(leaf?.budgetChars);
    const enabled = fromEnv ?? leaf?.enabled === true;
    return {
      enabled,
      ...(budgetChars !== undefined ? { budgetChars } : {}),
    };
  } catch {
    return { enabled: false };
  }
}

/** Build the plan for one request. Pure; the request is never mutated. */
export function buildSessionStartInjectionPlanFromRequest(
  request: SessionStartInjectionRequest,
  budgetChars?: number,
): SessionStartInjectionPlan {
  return buildSessionStartInjectionPlan({
    sessionKey: request.sessionKey,
    stage: request.stage,
    facts: request.facts,
    budgetChars: budgetChars ?? request.budgetChars,
  });
}

/**
 * Turn the included plan items into candidates.
 *
 * The slice is the contract: a `budget-partial` item injects exactly
 * `charsApplied` characters, so a reader who checks the plan against the prompt
 * finds them equal instead of "close enough".
 */
export function buildSessionStartInjectionCandidates(
  plan: SessionStartInjectionPlan,
  texts: Partial<Record<SessionStartSourceId, string>>,
): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  for (const item of plan.items) {
    if (!item.included || item.charsApplied <= 0) continue;
    const raw = texts[item.sourceId];
    if (typeof raw !== "string" || raw.length === 0) continue;
    const text = raw.slice(0, item.charsApplied);
    if (text.length === 0) continue;
    candidates.push(
      createContextCandidate({
        authorityObjectId: `session-start:${item.sourceId}`,
        authorityVersion: `${plan.schema}:${plan.stage}`,
        sourceId: `session-start:${item.sourceId}`,
        channel: SESSION_START_INJECTION_CHANNEL,
        target: "system_prompt",
        text,
      }),
    );
  }
  return candidates;
}

/**
 * Apply the request to one turn's candidate collection.
 *
 * The caller owns the turn ledger and the final projection; this only decides
 * what to collect. Every path that collects nothing still records a skip
 * decision, so "nothing was injected" always has a name.
 */
export function applySessionStartInjection(params: {
  turnId: string;
  request: SessionStartInjectionRequest;
  cfg?: unknown;
  env?: NodeJS.ProcessEnv;
}): SessionStartInjectionOutcome {
  const config = resolveSessionStartInjectionConfig(params.cfg, params.env);
  if (!config.enabled) {
    recordContextCandidateSkip(params.turnId, {
      sourceId: SESSION_START_CHANNEL_SOURCE_ID,
      channel: SESSION_START_INJECTION_CHANNEL,
      target: "system_prompt",
      reason: "flag-off",
    });
    return { applied: false, reason: "flag-off", plan: null, candidates: [], charsApplied: 0 };
  }

  const plan = buildSessionStartInjectionPlanFromRequest(params.request, config.budgetChars);
  const candidates = buildSessionStartInjectionCandidates(plan, params.request.texts);
  for (const candidate of candidates) {
    collectContextCandidate(params.turnId, candidate);
  }
  if (candidates.length === 0) {
    recordContextCandidateSkip(params.turnId, {
      sourceId: SESSION_START_CHANNEL_SOURCE_ID,
      channel: SESSION_START_INJECTION_CHANNEL,
      target: "system_prompt",
      reason: "empty",
    });
    return { applied: false, reason: "empty", plan, candidates, charsApplied: 0 };
  }
  return {
    applied: true,
    reason: "applied",
    plan,
    candidates,
    charsApplied: plan.charsApplied,
  };
}