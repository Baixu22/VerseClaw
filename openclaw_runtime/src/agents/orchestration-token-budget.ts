/**
 * C3-4: per-goal / per-wave token budgets for orchestration.
 */
import { codingObservability } from "../context-engine/coding-observability.js";

export type TokenBudget = {
  goalId: string;
  goalBudgetTokens: number;
  waveBudgetTokens: number;
  spentGoalTokens: number;
  spentWaveTokens: number;
  wave: number;
};

export type TokenBudgetDecision =
  | { ok: true; remainingGoal: number; remainingWave: number }
  | { ok: false; reason: "goal_budget_exceeded" | "wave_budget_exceeded"; abort: true };

const budgets = new Map<string, TokenBudget>();

export function createTokenBudget(params: {
  goalId: string;
  goalBudgetTokens: number;
  waveBudgetTokens: number;
}): TokenBudget {
  const b: TokenBudget = {
    goalId: params.goalId,
    goalBudgetTokens: Math.max(0, params.goalBudgetTokens),
    waveBudgetTokens: Math.max(0, params.waveBudgetTokens),
    spentGoalTokens: 0,
    spentWaveTokens: 0,
    wave: 1,
  };
  budgets.set(params.goalId, b);
  return b;
}

export function advanceWaveBudget(goalId: string, wave: number): void {
  const b = budgets.get(goalId);
  if (!b) return;
  b.wave = wave;
  b.spentWaveTokens = 0;
}

export function chargeTokenBudget(goalId: string, tokens: number): TokenBudgetDecision {
  const b = budgets.get(goalId);
  if (!b) {
    return { ok: true, remainingGoal: Number.POSITIVE_INFINITY, remainingWave: Number.POSITIVE_INFINITY };
  }
  const cost = Math.max(0, Math.floor(tokens));
  if (b.spentGoalTokens + cost > b.goalBudgetTokens) {
    codingObservability.recordTokenBudgetAbort();
    return { ok: false, reason: "goal_budget_exceeded", abort: true };
  }
  if (b.spentWaveTokens + cost > b.waveBudgetTokens) {
    codingObservability.recordTokenBudgetAbort();
    return { ok: false, reason: "wave_budget_exceeded", abort: true };
  }
  b.spentGoalTokens += cost;
  b.spentWaveTokens += cost;
  return {
    ok: true,
    remainingGoal: b.goalBudgetTokens - b.spentGoalTokens,
    remainingWave: b.waveBudgetTokens - b.spentWaveTokens,
  };
}

export function getTokenBudget(goalId: string): TokenBudget | undefined {
  return budgets.get(goalId);
}

export function __resetTokenBudgets(): void {
  budgets.clear();
}