---
title: openclaw_runtime/src/context-engine/turn-injection-budget.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/context-engine/turn-injection-budget.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
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
  contextHealthScoreToScorecard,
  recordContextHealth,
  scoreContextHealth,
  scoreInformationNovelty,
  scoreInjectionPressure,
} from "./context-health-monitor.js";
import { storeRuntimeScorecard } from "../observability/trace-buffer.js";
import {
  applyInjectionBudget,
  createInjectionBudget,
  remainingBudget,
  type ApplyBudgetResult,
  type InjectionBudgetState,
} from "./injection-budget.js";
import {
  resolveInjectionBudgetConfig,
  resetInjectionBudgetConfigCache,
} from "./injection-budget-config-source.js";

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
  "session_start",
  "working_memory",
  "tool_registry",
  "cvk_addition",
  "vtoken",
  "memory_pilot",
  "other",
] as const;

export type TurnInjectionChannel = (typeof TURN_INJECTION_PRECEDENCE)[number];

/**
 * B-1 channel policy — the heterogeneity table for the shared injection budget.
 *
 * Every channel carries a numeric `priority` (metadata: must stay ordered the
 * same way as `TURN_INJECTION_PRECEDENCE` — a regression test locks that) and a
 * `decayHalfLifeTurns` used by {@link decayFactorFor} to shrink the channel's
 * charge ceiling as a session's turns advance.
 *
 * Decay semantics (B-1, budget side): correctness-bearing context
 * (`knowledge` / `working_memory` / `tool_registry`) is pinned with
 * `Infinity` — losing it causes repeated work. Enrichment channels (`vtoken`,
 * `memory_pilot`) re-inject similar content every turn, so their older copies
 * are worth progressively less; a finite half-life lets them give budget back
 * to fresher, higher-value context as the session lengthens.
 *
 * `Infinity` is the default for every channel, so the budget behaves exactly as
 * before until an operator opts a channel into decay via
 * `runtime.contextBlock.injectionBudget.channelDecay`.
 */
export const TURN_INJECTION_CHANNEL_POLICY: Record<
  TurnInjectionChannel,
  { priority: number; decayHalfLifeTurns: number }
> = {
  knowledge: { priority: 100, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
  session_start: { priority: 95, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
  working_memory: { priority: 90, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
  tool_registry: { priority: 80, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
  cvk_addition: { priority: 70, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
  vtoken: { priority: 60, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
  memory_pilot: { priority: 50, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
  other: { priority: 10, decayHalfLifeTurns: Number.POSITIVE_INFINITY },
};

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
 * FP-P2-04: config overrides for the two budget numbers. The defaults
 * (`TURN_INJECTION_CHAR_BUDGET` / `TURN_INJECTION_DROP_ALERT_RATIO`) remain
 * the starting-line values from FP-P0-05; the getters resolve
 * `runtime.contextBlock.injectionBudget.*` from the on-disk config through
 * {@link resolveInjectionBudgetConfig} (mtime-keyed, so a config write applies
 * on the next turn without a restart). The setter is retained for in-process
 * callers and tests; explicit set values win over file overrides, keeping the
 * precedence deterministic. Values must come from real canary distributions
 * (see FP-P2-04 Hard locks); widening the total to eliminate degradation
 * is prohibited.
 */
let configuredTotalChars: number | undefined;
let configuredDropAlertRatio: number | undefined;

export function setTurnInjectionBudgetConfig(params: {
  totalChars?: number;
  dropAlertRatio?: number;
}): void {
  configuredTotalChars = params.totalChars;
  configuredDropAlertRatio = params.dropAlertRatio;
}

export function getEffectiveTurnInjectionCharBudget(env: NodeJS.ProcessEnv = process.env): number {
  if (configuredTotalChars !== undefined) return configuredTotalChars;
  return resolveInjectionBudgetConfig(env)?.totalChars ?? TURN_INJECTION_CHAR_BUDGET;
}

export function getEffectiveDropAlertRatio(env: NodeJS.ProcessEnv = process.env): number {
  if (configuredDropAlertRatio !== undefined) return configuredDropAlertRatio;
  return resolveInjectionBudgetConfig(env)?.dropAlertRatio ?? TURN_INJECTION_DROP_ALERT_RATIO;
}

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
  /**
   * #184: set when the bytes this charge applied already appeared in an earlier
   * channel's charge for the same turn. Per-channel `charsApplied` can only say
   * how much each source added; this is what makes "how much of it was a
   * repeat" answerable.
   */
  duplicateOfChannel?: TurnInjectionChannel;
  /** #184: characters of this charge that duplicate an earlier channel. */
  duplicateChars?: number;
  /** Precedence index at charge time; makes the degradation order replayable. */
  order: number;
  /** B-1: policy priority of the channel at charge time (metadata/audit). */
  priority: number;
  /** B-1: decay multiplier applied at charge time (1 = no decay). */
  decayFactor: number;
};

export type TurnInjectionLedger = {
  /** Observed prompt writes outside the managed character limit. No raw text is stored. */
  promptAccounting?: TurnPromptAccounting;
  turnId: string;
  /** B-1: zero-based turn counter used by channel decay; 0 ⇒ no decay yet. */
  turnIndex: number;
  budget: InjectionBudgetState;
  entries: TurnInjectionEntry[];
  /** Capacity held for enabled higher-precedence channels that charge later. */
  reservations: TurnInjectionReservation[];
  /** True once the kill switch zeroed this turn; every entry is then `skip`/0. */
  killed: boolean;
  /**
   * T-C1: mean novelty (0..1) of the unique candidates collected for this turn,
   * set by `collectContextCandidates`. Absent when nothing was collected.
   *
   * Carried on the ledger rather than recomputed here because
   * `context-candidate.ts` already computes it per candidate and averages it
   * (`diagnostics.avgNovelty`); requirement-4 is explicit that novelty must be
   * reused, not computed twice. Before this, that average had zero consumers —
   * it was written and never read, which is why `informationNovelty` was one of
   * the three health dimensions with no production input.
   */
  avgNovelty?: number;
  /**
   * #184: normalized content fingerprint -> the first channel that applied it
   * this turn. Cross-injection duplication is invisible in per-channel totals,
   * so it needs its own identity map instead of being inferred from them.
   */
  appliedContent: Map<string, TurnInjectionChannel>;
};

export type TurnInjectionReservation = {
  channels: TurnInjectionChannel[];
  remaining: number;
};

export type TurnInjectionAccounting = {
  promptAccounting?: TurnPromptAccounting;
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
  byChannel: Record<
    string,
    { requested: number; applied: number; disposition: TurnInjectionDisposition }
  >;
  /** Channels that degraded, in the order they were charged. */
  degradationOrder: Array<{ channel: TurnInjectionChannel; disposition: "truncate" | "drop" }>;
  /**
   * #184: applied characters that repeat content another channel already
   * injected this turn. Approximate by design: it compares the bytes actually
   * applied (whitespace-normalized), so a producer that knows two channels
   * carry the same underlying fact should pass a shared `contentKey` to
   * `chargeTurnInjection` instead of relying on byte equality.
   */
  crossInjectionDuplicateChars: number;
  /** #184: `crossInjectionDuplicateChars / charsApplied`, 0 when nothing applied. */
  crossInjectionDuplicationRatio: number;
};

const ledgers = new Map<string, TurnInjectionLedger>();

export type TurnPromptAccounting = {
  basePromptChars?: number;
  managedSystemChars: number;
  postOrchestrator: Record<string, { target: "system_prompt" | "message"; charsApplied: number }>;
};

function promptAccounting(ledger: TurnInjectionLedger): TurnPromptAccounting {
  return ledger.promptAccounting ??= { managedSystemChars: 0, postOrchestrator: {} };
}

export function recordManagedSystemChars(ledger: TurnInjectionLedger, chars: number): void {
  promptAccounting(ledger).managedSystemChars += chars;
}

/** Updating a source observation replaces its old reading; repeated projection is not a charge. */
export function recordPostOrchestratorContribution(
  ledger: TurnInjectionLedger,
  sourceId: string,
  charsApplied: number,
  target: "system_prompt" | "message" = "system_prompt",
): void {
  promptAccounting(ledger).postOrchestrator[sourceId] = { target, charsApplied };
}

export function observeTurnSystemPromptBase(ledger: TurnInjectionLedger, systemPrompt: string): void {
  const accounting = promptAccounting(ledger);
  const postSystemChars = Object.values(accounting.postOrchestrator)
    .filter(entry => entry.target === "system_prompt")
    .reduce((sum, entry) => sum + entry.charsApplied, 0);
  accounting.basePromptChars = Math.max(0, systemPrompt.length - postSystemChars - accounting.managedSystemChars);
}

/** Observe an actual successful write, separately from the unchanged managed budget. */
export function recordPostOrchestratorChange(
  ledger: TurnInjectionLedger,
  before: string,
  after: string,
  target: "system_prompt" | "message",
): void {
  if (before === after) return;
  const accounting = promptAccounting(ledger);
  const sourceId = `runtime-${target}`;
  const preservesBefore = after.includes(before);
  if (!preservesBefore && target === "system_prompt") {
    // This setter owns the base component; managed projections are appended
    // separately. A replacement retires prior base/post system attribution.
    accounting.basePromptChars = 0;
    for (const [id, entry] of Object.entries(accounting.postOrchestrator)) {
      if (entry.target === "system_prompt") delete accounting.postOrchestrator[id];
    }
  }
  const prior = accounting.postOrchestrator[sourceId]?.charsApplied ?? 0;
  const written = preservesBefore ? after.length - before.length : after.length;
  recordPostOrchestratorContribution(ledger, sourceId, prior + written, target);
}

/** Precedence index of a channel; unknown channels sort last. */
export function precedenceIndexOf(channel: TurnInjectionChannel): number {
  const index = TURN_INJECTION_PRECEDENCE.indexOf(channel);
  return index < 0 ? TURN_INJECTION_PRECEDENCE.length : index;
}

/**
 * Effective decay half-life (in turns) for a channel: an explicit
 * `runtime.contextBlock.injectionBudget.channelDecay.<channel>` value wins,
 * otherwise the `TURN_INJECTION_CHANNEL_POLICY` default. `Infinity` means the
 * channel never decays.
 */
export function getEffectiveChannelDecay(
  channel: TurnInjectionChannel,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const override = resolveInjectionBudgetConfig(env)?.channelDecay?.[channel];
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  return TURN_INJECTION_CHANNEL_POLICY[channel].decayHalfLifeTurns;
}

/**
 * B-1: per-turn decay multiplier for a channel. `1` means "full ceiling"
 * (no decay, or the turn has not advanced); with a finite half-life it follows
 * the classic exponential form `0.5^(turns / halfLife)` so each half-life
 * halves the channel's charge ceiling. The multiplier is applied to the
 * channel's own charge limit only — reservations held for higher-precedence
 * channels are subtracted first and are never decayed away.
 */
export function decayFactorFor(
  channel: TurnInjectionChannel,
  turnIndex: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const halfLife = getEffectiveChannelDecay(channel, env);
  if (!Number.isFinite(halfLife) || halfLife <= 0 || turnIndex <= 0) {
    return 1;
  }
  return Math.pow(0.5, turnIndex / halfLife);
}

/**
 * Get (or create) the ledger for a turn. All sources in one turn must pass the
 * same `turnId` — that is what makes the accounting summable.
 *
 * `killed: true` creates a zero-total ledger so every subsequent charge records a
 * `skip` with 0 chars, keeping FP-P0-02's "kill ⇒ accounting is zero" property.
 *
 * `turnIndex` is the B-1 decay clock: a zero-based turn counter for the session
 * this ledger belongs to (0 ⇒ no channel decay yet). Callers that track turns
 * pass the current index; callers that do not get 0 and decay is a no-op.
 */
export function beginTurnInjectionBudget(params: {
  turnId: string;
  total?: number;
  killed?: boolean;
  turnIndex?: number;
}): TurnInjectionLedger {
  const existing = ledgers.get(params.turnId);
  if (existing) return existing;
  const killed = params.killed === true;
  const ledger: TurnInjectionLedger = {
    turnId: params.turnId,
    turnIndex: Math.max(0, Math.floor(params.turnIndex ?? 0)),
    budget: createInjectionBudget(
      killed ? 0 : (params.total ?? getEffectiveTurnInjectionCharBudget()),
    ),
    entries: [],
    reservations: [],
    killed,
    appliedContent: new Map<string, TurnInjectionChannel>(),
  };
  ledgers.set(params.turnId, ledger);
  return ledger;
}

/** Look up an existing ledger without creating one. */
export function getTurnInjectionBudget(turnId: string): TurnInjectionLedger | undefined {
  return ledgers.get(turnId);
}

/**
 * Protect capacity for higher-precedence sources that are enabled but charge
 * later in the runtime lifecycle. A reservation is not a charge and therefore
 * never creates a synthetic byChannel entry.
 */
export function reserveTurnInjectionCapacity(
  ledger: TurnInjectionLedger,
  channels: readonly TurnInjectionChannel[],
  chars: number,
): void {
  if (ledger.killed) return;
  const uniqueChannels = [...new Set(channels)].toSorted(
    (left, right) => precedenceIndexOf(left) - precedenceIndexOf(right),
  );
  const requested = Math.min(
    ledger.budget.total,
    Math.max(0, Math.floor(Number.isFinite(chars) ? chars : 0)),
  );
  if (uniqueChannels.length === 0 || requested === 0) return;
  const existing = ledger.reservations.find(
    (reservation) =>
      reservation.channels.length === uniqueChannels.length &&
      reservation.channels.every((channel, index) => channel === uniqueChannels[index]),
  );
  if (existing) {
    existing.remaining = Math.max(existing.remaining, requested);
    return;
  }
  ledger.reservations.push({ channels: uniqueChannels, remaining: requested });
}

function capacityReservedForHigherPrecedence(
  ledger: TurnInjectionLedger,
  channel: TurnInjectionChannel,
): number {
  const channelOrder = precedenceIndexOf(channel);
  return ledger.reservations.reduce((total, reservation) => {
    if (reservation.channels.includes(channel)) return total;
    return reservation.channels.some(
      (reservedChannel) => precedenceIndexOf(reservedChannel) < channelOrder,
    )
      ? total + reservation.remaining
      : total;
  }, 0);
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
  allowTruncation = true,
  contentKey?: string,
): ApplyBudgetResult {
  const charsRequested = text?.length ?? 0;
  const order = precedenceIndexOf(channel);
  const priority = TURN_INJECTION_CHANNEL_POLICY[channel].priority;
  const decayFactor = decayFactorFor(channel, ledger.turnIndex);

  if (ledger.killed || charsRequested === 0) {
    ledger.entries.push({
      channel,
      disposition: "skip",
      charsRequested: ledger.killed ? 0 : charsRequested,
      charsApplied: 0,
      order,
      priority,
      decayFactor: ledger.killed ? 1 : decayFactor,
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

  const reservedForHigherPrecedence = capacityReservedForHigherPrecedence(ledger, channel);
  const rawLimit = Math.max(0, remainingBudget(ledger.budget) - reservedForHigherPrecedence);
  // B-1: decay shrinks this channel's ceiling, never the reservations held for
  // higher-precedence channels (those were subtracted before the multiplier).
  const chargeLimit = Math.max(0, Math.floor(rawLimit * decayFactor));
  // Structured message replacements must fit whole: truncating serialized
  // tool calls or summaries would change their meaning and break pairing.
  const limit = !allowTruncation && charsRequested > chargeLimit ? 0 : chargeLimit;
  const result = applyInjectionBudget(ledger.budget, text, channel, limit);
  for (const reservation of ledger.reservations) {
    if (reservation.channels.includes(channel)) {
      reservation.remaining = Math.max(0, reservation.remaining - result.charsApplied);
    }
  }
  const disposition: TurnInjectionDisposition =
    result.charsApplied === 0 ? "drop" : result.truncated ? "truncate" : "applied";
  // #184: fingerprint the bytes that actually landed, not the requested text, so
  // a truncated charge cannot over-claim identity with a full one.
  const duplicate = recordAppliedContent(ledger, channel, result.text, contentKey);
  ledger.entries.push({
    channel,
    disposition,
    charsRequested,
    charsApplied: result.charsApplied,
    order,
    priority,
    decayFactor,
    ...(duplicate
      ? { duplicateOfChannel: duplicate.channel, duplicateChars: duplicate.chars }
      : {}),
  });
  return result;
}

function normalizeContentForKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * #184: cheap fingerprint of injected bytes (FNV-1a over the
 * whitespace-normalized text plus its length). It is an exact-match detector —
 * semantically identical content serialized differently will not collide, which
 * is why producers that know two channels carry the same underlying item should
 * pass a shared `contentKey` instead.
 */
function contentHashOf(text: string): string {
  const normalized = normalizeContentForKey(text);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `bytes:${hash.toString(16)}:${normalized.length}`;
}

/**
 * #184: remember what this charge applied and report whether a *different*
 * channel already applied the same content this turn. The same channel charging
 * twice is not cross-injection duplication and is ignored.
 */
function recordAppliedContent(
  ledger: TurnInjectionLedger,
  channel: TurnInjectionChannel,
  appliedText: string | undefined,
  contentKey: string | undefined,
): { channel: TurnInjectionChannel; chars: number } | undefined {
  if (!appliedText || appliedText.length === 0) {
    return undefined;
  }
  const key = contentKey ?? contentHashOf(appliedText);
  const priorChannel = ledger.appliedContent.get(key);
  if (priorChannel === undefined) {
    ledger.appliedContent.set(key, channel);
    return undefined;
  }
  if (priorChannel === channel) {
    return undefined;
  }
  return { channel: priorChannel, chars: appliedText.length };
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
    priority: TURN_INJECTION_CHANNEL_POLICY[channel].priority,
    decayFactor: 1,
  });
}

/**
 * Summarize the ledger. `charsApplied` equals only the characters the DCS
 * injection channels actually appended to this turn under the injection
 * budget (per-entry results from `applyInjectionBudget` in
 * injection-budget.ts). It is NOT the turn's total prompt growth: baseline
 * prompt components that never charge the budget — the base system prompt
 * and agent-level extra system prompt text — are not in this denominator.
 * TF-0738 keeps that managed counter intact and adds optional promptAccounting
 * for base/post system components; final snapshots independently check coverage.
 */
export function summarizeTurnInjection(ledger: TurnInjectionLedger): TurnInjectionAccounting {
  let charsApplied = 0;
  let charsRequested = 0;
  let charsDropped = 0;
  let charsTruncated = 0;
  let crossInjectionDuplicateChars = 0;
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
    crossInjectionDuplicateChars += entry.duplicateChars ?? 0;
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
    ...(ledger.promptAccounting ? {
      promptAccounting: {
        ...ledger.promptAccounting,
        postOrchestrator: Object.fromEntries(Object.entries(ledger.promptAccounting.postOrchestrator)
          .map(([id, entry]) => [id, { ...entry }])),
      },
    } : {}),
    total,
    charsApplied,
    charsRequested,
    charsDropped,
    charsTruncated,
    remaining: remainingBudget(ledger.budget),
    dropRatio,
    alert: dropRatio > getEffectiveDropAlertRatio(),
    killed: ledger.killed,
    byChannel,
    degradationOrder,
    crossInjectionDuplicateChars,
    crossInjectionDuplicationRatio:
      charsApplied > 0 ? crossInjectionDuplicateChars / charsApplied : 0,
  };
}

/** Close the turn, emit the accounting to observability, and free the ledger. */
export function endTurnInjectionBudget(turnId: string): TurnInjectionAccounting | undefined {
  const ledger = ledgers.get(turnId);
  if (!ledger) return undefined;
  const accounting = summarizeTurnInjection(ledger);
  const avgNovelty = ledger.avgNovelty;
  ledgers.delete(turnId);
  try {
    // FP-P1-11: byChannel/degradationOrder ride along so the runtime ack can
    // show which sources charged this turn, not just the totals.
    dcsObservability.recordTurnInjectionAccounting({ ...accounting, turnId });
    // B-4: score the turn's injection pressure into the context-health registry
    // and project it onto the Observability scorecard pipeline (synthetic
    // `ctx-health-<turnId>` trace id, bounded by its own cap).
    //
    // T-C1: informationNovelty now rides along when the candidate collector
    // recorded one. Left `undefined` when it did not, so the score reports it in
    // `noDataDimensions` instead of defaulting to a misleading 100.
    const healthScore = scoreContextHealth({
      turnId,
      injectionPressure: scoreInjectionPressure(accounting),
      ...(avgNovelty === undefined
        ? {}
        : {
            informationNovelty: scoreInformationNovelty([
              { channel: "aggregate", novelty: avgNovelty },
            ]),
          }),
    });
    recordContextHealth(healthScore);
    storeRuntimeScorecard(contextHealthScoreToScorecard(healthScore));
  } catch {
    // Observability must never break a turn.
  }
  return accounting;
}

/** Test helper: drop every in-flight ledger, reset config overrides, and clear
 * the file-backed config cache so tests never observe a stale override. */
export function resetTurnInjectionBudgetsForTests(): void {
  ledgers.clear();
  configuredTotalChars = undefined;
  configuredDropAlertRatio = undefined;
  resetInjectionBudgetConfigCache();
}

~~~
