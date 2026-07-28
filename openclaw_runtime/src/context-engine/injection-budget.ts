/**
 * TASK-P2-03: shared character budget coordinator for multi-injection surfaces.
 *
 * Coordinates sequential DCS transformContext injections (working_memory,
 * tool_registry, knowledge) against a shared character ceiling (default aligns
 * with assembler KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000).
 *
 * Fail-closed: budget <= 0 yields no injection text (empty apply).
 */
import { dcsObservability } from "./dcs-observability.js";

/** Default shared ceiling for DCS transformContext injections (chars). */
export const DEFAULT_INJECTION_CHAR_BUDGET = 2000;

export type InjectionChannel =
  | "working_memory"
  | "tool_registry"
  | "knowledge"
  | "cvk_addition"
  | "vtoken"
  | "memory_pilot"
  | "other";

export type InjectionBudgetState = {
  total: number;
  used: number;
  overflows: number;
  truncations: number;
  drops: number;
};

export type ApplyBudgetResult = {
  text: string | undefined;
  applied: boolean;
  truncated: boolean;
  dropped: boolean;
  charsApplied: number;
  remainingAfter: number;
};

export function createInjectionBudget(
  total: number = DEFAULT_INJECTION_CHAR_BUDGET,
): InjectionBudgetState {
  const t = Math.max(0, Math.floor(total));
  return { total: t, used: 0, overflows: 0, truncations: 0, drops: 0 };
}

export function remainingBudget(state: InjectionBudgetState): number {
  return Math.max(0, state.total - state.used);
}

export function applyInjectionBudget(
  state: InjectionBudgetState,
  text: string | undefined,
  channel: InjectionChannel = "other",
): ApplyBudgetResult {
  if (!text || text.length === 0) {
    return {
      text: undefined,
      applied: false,
      truncated: false,
      dropped: false,
      charsApplied: 0,
      remainingAfter: remainingBudget(state),
    };
  }
  const rem = remainingBudget(state);
  if (rem <= 0) {
    state.overflows += 1;
    state.drops += 1;
    dcsObservability.recordInjectionBudgetOverflow({
      channel,
      requested: text.length,
      applied: 0,
      dropped: true,
    });
    return {
      text: undefined,
      applied: false,
      truncated: false,
      dropped: true,
      charsApplied: 0,
      remainingAfter: 0,
    };
  }
  if (text.length <= rem) {
    state.used += text.length;
    return {
      text,
      applied: true,
      truncated: false,
      dropped: false,
      charsApplied: text.length,
      remainingAfter: remainingBudget(state),
    };
  }
  state.overflows += 1;
  state.truncations += 1;
  if (rem < 2) {
    state.drops += 1;
    dcsObservability.recordInjectionBudgetOverflow({
      channel,
      requested: text.length,
      applied: 0,
      dropped: true,
    });
    return {
      text: undefined,
      applied: false,
      truncated: true,
      dropped: true,
      charsApplied: 0,
      remainingAfter: rem,
    };
  }
  const sliced = `${text.slice(0, rem - 1)}…`;
  state.used += sliced.length;
  dcsObservability.recordInjectionBudgetOverflow({
    channel,
    requested: text.length,
    applied: sliced.length,
    dropped: false,
  });
  return {
    text: sliced,
    applied: true,
    truncated: true,
    dropped: false,
    charsApplied: sliced.length,
    remainingAfter: remainingBudget(state),
  };
}

export function snapshotInjectionBudget(state: InjectionBudgetState): InjectionBudgetState {
  return { ...state };
}
