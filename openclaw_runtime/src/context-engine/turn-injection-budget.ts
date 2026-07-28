/**
 * FP-P0-05: one injection budget per agent turn, shared by every source.
 *
 * Before this task the only budget was `createInjectionBudget()` inside
 * `Assembler.assemble()`, which covered the three DCS transformContext channels
 * and nothing else. VToken (`## Working Context`), the Runtime Memory inject pilot
 * (`## Memory Context`) and the CVK `systemPromptAddition` each grew the prompt on
 * their own, off the books — so the "budget" could report 0 overflows while the
 * turn had grown by several thousand characters.
 *
 * This module holds one ledger per turn. Every source charges the same ledger, in
 * a fixed precedence order, so the accounting sums to the real prompt growth and
 * degradation is reproducible.
 *
 * See `## Decision` in docs/dev/first-product-controlled-preview/tasks/FP-P0-05.md
 * for the four decisions this encodes (precedence / unit / degraded semantics /
 * alert threshold).
 */
import { dcsObservability } from "./dcs-observability.js";
import {
  applyInjectionBudget,
  createInjectionBudget,
  remainingBudget,
  type ApplyBudgetResult,
  type InjectionBudgetState,
} from "./injection-budget.js";

/**
 * Decision 1 — precedence. Lower index charges the budget first, so when the turn
 * runs out of room the *later* sources are the ones that degrade.
 *
 * Rationale: correctness-bearing context outranks convenience context.
 * `knowledge` (compass/role-memory: the objective and role constraints) and
 * `working_memory` (what the agent just did — losing it causes repeated work)
 * come first. `tool_registry` is recoverable, the model can still call tools it
 * cannot see summarized. `cvk_addition`, `vtoken` and `memory_pilot` are
 * enrichment: valuable, but a turn without them is still correct.
 */
export const TURN_INJECTION_PRECEDENCE = [
  "knowledge",
  "working_memory",
  "tool_registry",
  "cvk_addition",
  "vtoken",
  "memory_pilot",
  "other",
] as const;

export type TurnInjectionChannel = (typeof TURN_INJECTION_PRECEDENCE)[number];

/**
 * Decision 2 — unit and layering. The budget is counted in **characters**, single
 * flat pool, no per-channel sub-budgets.
 *
 * Why characters: every injection site already measures characters
 * (`applyInjectionBudget`, `recordCvkSystemPromptAddition`, the orchestrator's
 * lineage `chars`), and character counts are exact and provider-independent.
 * Token counts would need a tokenizer per provider, would disagree between
 * accounting and enforcement, and cannot be summed across sources honestly.
 * VToken keeps its own *internal* token budget for packing; that is a separate
 * concern from how much prompt the turn is allowed to grow.
 *
 * Why flat: per-channel sub-budgets would let an idle channel's reservation go
 * unused while a loaded channel truncates, which is worse for the same total.
 * Precedence already prevents starvation of the important channels.
 */
export const TURN_INJECTION_CHAR_BUDGET = 6000;

/**
 * Decision 4 — operational threshold. Alert when dropped characters exceed this
 * share of the turn's total budget: at that point the turn is losing enough
 * context that behavior is affected and the budget (or an upstream producer) needs
 * a look. Chosen as a starting line for the controlled preview; it must be revised
 * with real data rather than by widening the budget until drops disappear.
 */
export const TURN_INJECTION_DROP_ALERT_RATIO = 0.1;

/**
 * Decision 3 — degraded semantics, distinguishable in observation:
 *   `skip`     — the source was never charged (flag off, kill switch, nothing to
 *                inject). Not a degradation; `requested` is 0.
 *   `truncate` — charged, did not fit whole, a prefix was injected.
 *                `charsApplied < charsRequested` and `charsApplied > 0`.
 *   `drop`     — charged, nothing was injected. `charsApplied === 0` with
 *                `charsRequested > 0`.
 */
export type TurnInjectionDisposition = "applied" | "truncate" | "drop" | "skip";

export type TurnInjectionEntry = {
  channel: TurnInjectionChannel;
  disposition: TurnInjectionDisposition;
  charsRequested: number;
  charsApplied: number;
  /** Precedence index at charge time; makes the degradation order replayable. */
  order: number;
};

export type TurnInjectionLedger = {
  turnId: string;
  budget: InjectionBudgetState;
  entries: TurnInjectionEntry[];
  /** True once the kill switch zeroed this turn; every entry is then `skip`/0. */
  killed: boolean;
};

export type TurnInjectionAccounting = {
  turnId: string;
  total: number;
  charsApplied: number;
  charsRequested: number;
  charsDropped: number;
  charsTruncated: number;
  remaining: number;
  dropRatio: number;
  alert: boolean;
  killed: boolean;
  byChannel: Record<string, { requested: number; applied: number; disposition: TurnInjectionDisposition }>;
  /** Channels that degraded, in the order they were charged. */
  degradationOrder: Array<{ channel: TurnInjectionChannel; disposition: "truncate" | "drop" }>;
};

const ledgers = new Map<string, TurnInjectionLedger>();

/** Precedence index of a channel; unknown channels sort last. */
export function precedenceIndexOf(channel: TurnInjectionChannel): number {
  const index = TURN_INJECTION_PRECEDENCE.indexOf(channel);
  return index < 0 ? TURN_INJECTION_PRECEDENCE.length : index;
}

/**
 * Get (or create) the ledger for a turn. All sources in one turn must pass the
 * same `turnId` — that is what makes the accounting summable.
 *
 * `killed: true` creates a zero-total ledger so every subsequent charge records a
 * `skip` with 0 chars, keeping FP-P0-02's "kill ⇒ accounting is zero" property.
 */
export function beginTurnInjectionBudget(params: {
  turnId: string;
  total?: number;
  killed?: boolean;
}): TurnInjectionLedger {
  const existing = ledgers.get(params.turnId);
  if (existing) return existing;
  const killed = params.killed === true;
  const ledger: TurnInjectionLedger = {
    turnId: params.turnId,
    budget: createInjectionBudget(killed ? 0 : (params.total ?? TURN_INJECTION_CHAR_BUDGET)),
    entries: [],
    killed,
  };
  ledgers.set(params.turnId, ledger);
  return ledger;
}

/** Look up an existing ledger without creating one. */
export function getTurnInjectionBudget(turnId: string): TurnInjectionLedger | undefined {
  return ledgers.get(turnId);
}

/**
 * Charge one source against the turn's shared budget.
 *
 * Returns the text the caller may actually inject (possibly truncated, possibly
 * undefined). Callers must inject exactly what is returned — injecting the
 * original text after a truncate would put the ledger out of sync with the prompt.
 */
export function chargeTurnInjection(
  ledger: TurnInjectionLedger,
  channel: TurnInjectionChannel,
  text: string | undefined,
): ApplyBudgetResult {
  const charsRequested = text?.length ?? 0;
  const order = precedenceIndexOf(channel);

  if (ledger.killed || charsRequested === 0) {
    ledger.entries.push({
      channel,
      disposition: "skip",
      charsRequested: ledger.killed ? 0 : charsRequested,
      charsApplied: 0,
      order,
    });
    return {
      text: undefined,
      applied: false,
      truncated: false,
      dropped: false,
      charsApplied: 0,
      remainingAfter: remainingBudget(ledger.budget),
    };
  }

  const result = applyInjectionBudget(ledger.budget, text, channel);
  const disposition: TurnInjectionDisposition = result.charsApplied === 0
    ? "drop"
    : result.truncated
      ? "truncate"
      : "applied";
  ledger.entries.push({
    channel,
    disposition,
    charsRequested,
    charsApplied: result.charsApplied,
    order,
  });
  return result;
}

/** Record a source that never ran (flag off / nothing to inject). */
export function skipTurnInjection(
  ledger: TurnInjectionLedger,
  channel: TurnInjectionChannel,
): void {
  ledger.entries.push({
    channel,
    disposition: "skip",
    charsRequested: 0,
    charsApplied: 0,
    order: precedenceIndexOf(channel),
  });
}

/** Summarize the ledger; `charsApplied` must equal the turn's real prompt growth. */
export function summarizeTurnInjection(ledger: TurnInjectionLedger): TurnInjectionAccounting {
  let charsApplied = 0;
  let charsRequested = 0;
  let charsDropped = 0;
  let charsTruncated = 0;
  const byChannel: TurnInjectionAccounting["byChannel"] = {};
  const degradationOrder: TurnInjectionAccounting["degradationOrder"] = [];

  for (const entry of ledger.entries) {
    charsApplied += entry.charsApplied;
    charsRequested += entry.charsRequested;
    if (entry.disposition === "drop") {
      charsDropped += entry.charsRequested;
    } else if (entry.disposition === "truncate") {
      charsTruncated += entry.charsRequested - entry.charsApplied;
    }
    const prev = byChannel[entry.channel];
    byChannel[entry.channel] = {
      requested: (prev?.requested ?? 0) + entry.charsRequested,
      applied: (prev?.applied ?? 0) + entry.charsApplied,
      disposition: entry.disposition,
    };
    if (entry.disposition === "drop" || entry.disposition === "truncate") {
      degradationOrder.push({ channel: entry.channel, disposition: entry.disposition });
    }
  }

  const total = ledger.budget.total;
  const lost = charsDropped + charsTruncated;
  const dropRatio = total > 0 ? lost / total : 0;

  return {
    turnId: ledger.turnId,
    total,
    charsApplied,
    charsRequested,
    charsDropped,
    charsTruncated,
    remaining: remainingBudget(ledger.budget),
    dropRatio,
    alert: dropRatio > TURN_INJECTION_DROP_ALERT_RATIO,
    killed: ledger.killed,
    byChannel,
    degradationOrder,
  };
}

/** Close the turn, emit the accounting to observability, and free the ledger. */
export function endTurnInjectionBudget(turnId: string): TurnInjectionAccounting | undefined {
  const ledger = ledgers.get(turnId);
  if (!ledger) return undefined;
  const accounting = summarizeTurnInjection(ledger);
  ledgers.delete(turnId);
  try {
    // FP-P1-11: byChannel/degradationOrder ride along so the runtime ack can
    // show which sources charged this turn, not just the totals.
    dcsObservability.recordTurnInjectionAccounting({ ...accounting, turnId });
  } catch {
    // Observability must never break a turn.
  }
  return accounting;
}

/** Test helper: drop every in-flight ledger. */
export function resetTurnInjectionBudgetsForTests(): void {
  ledgers.clear();
}
