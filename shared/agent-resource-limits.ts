/**
 * Agent resource limits — turn/token/cost budgets, history memory caps,
 * tool-result size caps, and turn timeouts (P5-004 / F-UX-001).
 *
 * Pure helpers so unit tests do not need Electron or the chat store.
 */

export type AgentResourceLimits = {
  /** Max messages retained in the chat store for a session (memory ceiling). */
  maxRenderedMessages: number;
  /** Page size when loading history. */
  historyPageSize: number;
  /** Max DOM rows rendered at once (windowing; not full list mount). */
  maxDomRenderMessages: number;
  /** Cap for a single tool-result body shown/kept in UI text projections. */
  maxToolResultChars: number;
  /**
   * Session total-token budget. Null = unlimited.
   * When usage.totalTokens >= budget, new turns are rejected.
   */
  maxSessionTotalTokens: number | null;
  /** Session cost budget in USD. Null = unlimited. */
  maxSessionCostUsd: number | null;
  /** Hard turn timeout; after this the UI must abort and release run state. */
  turnTimeoutMs: number;
};

export type SessionUsageSnapshot = {
  totalTokens?: number | null;
  costUsd?: number | null;
};

export type BudgetDenialCode =
  | 'TOKEN_BUDGET_EXCEEDED'
  | 'COST_BUDGET_EXCEEDED'
  | 'TURN_TIMEOUT';

export type BudgetDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: BudgetDenialCode;
      message: string;
      limit: number;
      used: number;
    };

export const DEFAULT_AGENT_RESOURCE_LIMITS: AgentResourceLimits = {
  maxRenderedMessages: 300,
  historyPageSize: 200,
  maxDomRenderMessages: 120,
  maxToolResultChars: 80_000,
  maxSessionTotalTokens: 1_000_000,
  maxSessionCostUsd: 100,
  turnTimeoutMs: 30 * 60 * 1000, // 30 minutes hard ceiling
};

let limits: AgentResourceLimits = { ...DEFAULT_AGENT_RESOURCE_LIMITS };

export function getAgentResourceLimits(): AgentResourceLimits {
  return { ...limits };
}

export function configureAgentResourceLimits(partial: Partial<AgentResourceLimits>): AgentResourceLimits {
  limits = {
    maxRenderedMessages: partial.maxRenderedMessages ?? limits.maxRenderedMessages,
    historyPageSize: partial.historyPageSize ?? limits.historyPageSize,
    maxDomRenderMessages: partial.maxDomRenderMessages ?? limits.maxDomRenderMessages,
    maxToolResultChars: partial.maxToolResultChars ?? limits.maxToolResultChars,
    maxSessionTotalTokens:
      partial.maxSessionTotalTokens !== undefined
        ? partial.maxSessionTotalTokens
        : limits.maxSessionTotalTokens,
    maxSessionCostUsd:
      partial.maxSessionCostUsd !== undefined ? partial.maxSessionCostUsd : limits.maxSessionCostUsd,
    turnTimeoutMs: partial.turnTimeoutMs ?? limits.turnTimeoutMs,
  };
  return getAgentResourceLimits();
}

export function resetAgentResourceLimits(): void {
  limits = { ...DEFAULT_AGENT_RESOURCE_LIMITS };
}

export function evaluateTurnBudget(
  usage: SessionUsageSnapshot | null | undefined,
  override: Partial<AgentResourceLimits> = {},
): BudgetDecision {
  const cfg = { ...getAgentResourceLimits(), ...override };
  const totalTokens = typeof usage?.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : 0;
  const costUsd = typeof usage?.costUsd === 'number' && Number.isFinite(usage.costUsd)
    ? usage.costUsd
    : 0;

  if (cfg.maxSessionTotalTokens != null && totalTokens >= cfg.maxSessionTotalTokens) {
    return {
      allowed: false,
      code: 'TOKEN_BUDGET_EXCEEDED',
      message: `Session token budget exceeded (${totalTokens} / ${cfg.maxSessionTotalTokens}). Start a new session or raise the budget.`,
      limit: cfg.maxSessionTotalTokens,
      used: totalTokens,
    };
  }

  if (cfg.maxSessionCostUsd != null && costUsd >= cfg.maxSessionCostUsd) {
    return {
      allowed: false,
      code: 'COST_BUDGET_EXCEEDED',
      message: `Session cost budget exceeded ($${costUsd.toFixed(4)} / $${cfg.maxSessionCostUsd.toFixed(4)}). Start a new session or raise the budget.`,
      limit: cfg.maxSessionCostUsd,
      used: costUsd,
    };
  }

  return { allowed: true };
}

export function isTurnTimedOut(
  startedAtMs: number | null | undefined,
  nowMs: number,
  timeoutMs: number = getAgentResourceLimits().turnTimeoutMs,
): boolean {
  if (startedAtMs == null || !Number.isFinite(startedAtMs) || startedAtMs <= 0) return false;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false;
  return nowMs - startedAtMs >= timeoutMs;
}

/**
 * Keep only the newest `max` messages — stable memory ceiling for large histories.
 */
export function capMessagesForMemory<T>(messages: readonly T[], max?: number): {
  messages: T[];
  truncated: boolean;
  dropped: number;
  max: number;
} {
  const ceiling = max ?? getAgentResourceLimits().maxRenderedMessages;
  const safeMax = Math.max(1, Math.floor(ceiling));
  if (messages.length <= safeMax) {
    return { messages: [...messages], truncated: false, dropped: 0, max: safeMax };
  }
  const dropped = messages.length - safeMax;
  return {
    messages: messages.slice(dropped) as T[],
    truncated: true,
    dropped,
    max: safeMax,
  };
}

/**
 * Truncate oversized tool results so floods cannot blow UI/memory.
 */
export function capToolResultText(
  text: string,
  maxChars: number = getAgentResourceLimits().maxToolResultChars,
): { text: string; truncated: boolean; originalLength: number; maxChars: number } {
  const originalLength = text?.length ?? 0;
  const safeMax = Math.max(64, Math.floor(maxChars));
  if (originalLength <= safeMax) {
    return { text: text ?? '', truncated: false, originalLength, maxChars: safeMax };
  }
  const markerPrefix = '\n...[tool result truncated ';
  const markerSuffix = ' chars]...\n';
  const maxDroppedDigits = String(originalLength).length;
  const contentBudget = Math.max(
    0,
    safeMax - markerPrefix.length - markerSuffix.length - maxDroppedDigits,
  );
  const headChars = Math.ceil(contentBudget / 2);
  const tailChars = Math.floor(contentBudget / 2);
  const dropped = originalLength - headChars - tailChars;
  return {
    text: [
      text.slice(0, headChars),
      `${markerPrefix}${dropped}${markerSuffix}`,
      tailChars > 0 ? text.slice(-tailChars) : '',
    ].join(''),
    truncated: true,
    originalLength,
    maxChars: safeMax,
  };
}

/**
 * Select a DOM render window anchored at the end (chat sticky-bottom default).
 * Returns half-open [start, end).
 */
export function selectMessageRenderWindow(
  total: number,
  opts?: { maxDomNodes?: number; anchorOffsetFromEnd?: number },
): { start: number; end: number; windowed: boolean } {
  const maxDom = Math.max(1, Math.floor(opts?.maxDomNodes ?? getAgentResourceLimits().maxDomRenderMessages));
  const totalSafe = Math.max(0, Math.floor(total));
  if (totalSafe <= maxDom) {
    return { start: 0, end: totalSafe, windowed: false };
  }
  const offset = Math.max(0, Math.floor(opts?.anchorOffsetFromEnd ?? 0));
  const end = Math.max(0, totalSafe - offset);
  const start = Math.max(0, end - maxDom);
  return { start, end: Math.max(start, end), windowed: true };
}

/**
 * Build a visible budget-rejection error string for the chat UI.
 */
export function formatBudgetRejection(decision: Extract<BudgetDecision, { allowed: false }>): string {
  return `[${decision.code}] ${decision.message}`;
}
