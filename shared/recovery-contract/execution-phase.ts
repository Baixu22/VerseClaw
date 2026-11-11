/**
 * Durable execution-phase contract for TF-0717.
 *
 * This module is deliberately pure: it imports no runtime, storage, clock,
 * environment, or production module. It defines the shared vocabulary and
 * decision table; the TaskFlow lifecycle owner remains the only writer that
 * persists a phase, and domain journals remain the effect/idempotency truth.
 *
 * Semantics:
 * - `admitted`         durable admission; dispatch has not been committed.
 * - `dispatched`       dispatch intent committed; an executor may have observed it.
 * - `effect_pending`   effect intent committed BEFORE the effectful operation.
 * - `effect_committed` a domain journal/receipt proves the effect was applied.
 * - `verified`         post-effect verification passed; no effect may run again.
 * - `terminal`         successful terminal settlement.
 * - `failed`           terminal failure; never automatically replayed.
 * - `aborted`          terminal cancellation.
 *
 * `isTerminalPhase()` treats `terminal`, `failed`, and `aborted` as the
 * terminal family. A same-phase commit is an idempotent no-op, not a transition;
 * this is why `canTransition(x, x)` is false while `isIdempotentCommit(x, x)`
 * is true.
 */

export const EXECUTION_PHASES = [
  'admitted',
  'dispatched',
  'effect_pending',
  'effect_committed',
  'verified',
  'terminal',
  'failed',
  'aborted',
] as const;

export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export const TERMINAL_EXECUTION_PHASES = ['terminal', 'failed', 'aborted'] as const;

export type TerminalExecutionPhase = (typeof TERMINAL_EXECUTION_PHASES)[number];

export type ExecutionPhaseTransition = readonly [ExecutionPhase, ExecutionPhase];

/**
 * The only legal phase changes. Terminal phases have no outgoing edges.
 *
 * `effect_pending -> failed` and `effect_pending -> aborted` are only allowed
 * after reconciliation proves the effect was NOT applied. An unknown effect
 * outcome stays in `effect_pending` until a journal/receipt resolves it.
 */
export const EXECUTION_PHASE_TRANSITIONS = [
  ['admitted', 'dispatched'],
  ['admitted', 'failed'],
  ['admitted', 'aborted'],
  ['dispatched', 'effect_pending'],
  ['dispatched', 'failed'],
  ['dispatched', 'aborted'],
  ['effect_pending', 'effect_committed'],
  ['effect_pending', 'failed'],
  ['effect_pending', 'aborted'],
  ['effect_committed', 'verified'],
  ['effect_committed', 'failed'],
  ['verified', 'terminal'],
] as const satisfies readonly ExecutionPhaseTransition[];

const LEGAL_TRANSITION_KEYS: ReadonlySet<string> = new Set(
  EXECUTION_PHASE_TRANSITIONS.map(([from, to]) => `${from}->${to}`),
);

const TERMINAL_PHASE_SET: ReadonlySet<ExecutionPhase> = new Set(TERMINAL_EXECUTION_PHASES);

export function canTransition(from: ExecutionPhase, to: ExecutionPhase): boolean {
  return LEGAL_TRANSITION_KEYS.has(`${from}->${to}`);
}

export function isTerminalPhase(phase: ExecutionPhase): phase is TerminalExecutionPhase {
  return TERMINAL_PHASE_SET.has(phase);
}

/**
 * How a restarted owner must treat the last durable phase.
 *
 * - `safe`      re-entry from this phase cannot duplicate a committed effect.
 * - `unsafe`    never re-run the effectful path; only continue post-effect work
 *               or require a new explicit run.
 * - `reconcile` an external boundary may have been crossed; compare the
 *               durable intent with the domain journal/receipt before choosing
 *               any next step. Never auto-replay directly from this phase.
 */
export type ReplayDisposition = 'safe' | 'unsafe' | 'reconcile';

const REPLAY_DISPOSITIONS = {
  admitted: 'safe',
  dispatched: 'reconcile',
  effect_pending: 'reconcile',
  effect_committed: 'unsafe',
  verified: 'safe',
  terminal: 'safe',
  failed: 'unsafe',
  aborted: 'safe',
} as const satisfies Record<ExecutionPhase, ReplayDisposition>;

export function classifyReplay(phase: ExecutionPhase): ReplayDisposition {
  return REPLAY_DISPOSITIONS[phase];
}

/**
 * Pure decision for one CAS attempt before any revision is allocated.
 *
 * `apply`  a legal forward transition; the writer must CAS the same row revision.
 * `noop`   the requested phase equals the durable phase; return the current
 *          revision without incrementing it or writing again.
 * `reject` an illegal transition or any attempt to leave a terminal phase.
 */
export type PhaseCommitIntent = 'apply' | 'noop' | 'reject';

export function classifyPhaseCommit(from: ExecutionPhase, to: ExecutionPhase): PhaseCommitIntent {
  if (from === to) return 'noop';
  return canTransition(from, to) ? 'apply' : 'reject';
}

/** True exactly when a retry may return the already-committed phase unchanged. */
export function isIdempotentCommit(from: ExecutionPhase, to: ExecutionPhase): boolean {
  return from === to;
}