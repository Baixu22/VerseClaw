/**
 * P5-004: agent turn/token/cost budgets, history memory caps, tool result caps, timeouts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  capMessagesForMemory,
  capToolResultText,
  configureAgentResourceLimits,
  evaluateTurnBudget,
  formatBudgetRejection,
  isTurnTimedOut,
  resetAgentResourceLimits,
  selectMessageRenderWindow,
} from '../../shared/agent-resource-limits';

afterEach(() => {
  resetAgentResourceLimits();
});

describe('P5-004 token/cost budget (A1)', () => {
  it('allows turns under budget', () => {
    configureAgentResourceLimits({ maxSessionTotalTokens: 100_000, maxSessionCostUsd: 5 });
    expect(evaluateTurnBudget({ totalTokens: 10, costUsd: 0.01 }).allowed).toBe(true);
  });

  it('visibly rejects when token budget exceeded', () => {
    configureAgentResourceLimits({ maxSessionTotalTokens: 1_000 });
    const decision = evaluateTurnBudget({ totalTokens: 1_000, costUsd: 0 });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe('TOKEN_BUDGET_EXCEEDED');
    expect(formatBudgetRejection(decision)).toContain('TOKEN_BUDGET_EXCEEDED');
    expect(formatBudgetRejection(decision)).toMatch(/budget exceeded/i);
  });

  it('visibly rejects when cost budget exceeded', () => {
    configureAgentResourceLimits({ maxSessionCostUsd: 0.5 });
    const decision = evaluateTurnBudget({ totalTokens: 10, costUsd: 0.5 });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe('COST_BUDGET_EXCEEDED');
  });

  it('null budgets mean unlimited', () => {
    configureAgentResourceLimits({ maxSessionTotalTokens: null, maxSessionCostUsd: null });
    expect(evaluateTurnBudget({ totalTokens: 1e12, costUsd: 1e6 }).allowed).toBe(true);
  });
});

describe('P5-004 history memory ceiling (A2)', () => {
  it('caps large history to a stable max (drops oldest)', () => {
    configureAgentResourceLimits({ maxRenderedMessages: 50 });
    const messages = Array.from({ length: 200 }, (_, i) => ({ id: `m-${i}` }));
    const capped = capMessagesForMemory(messages);
    expect(capped.truncated).toBe(true);
    expect(capped.dropped).toBe(150);
    expect(capped.messages).toHaveLength(50);
    expect(capped.messages[0].id).toBe('m-150');
    expect(capped.messages[49].id).toBe('m-199');
  });

  it('large history load keeps memory under ceiling for any input size', () => {
    configureAgentResourceLimits({ maxRenderedMessages: 300 });
    for (const n of [0, 1, 300, 301, 10_000, 50_000]) {
      const messages = Array.from({ length: n }, (_, i) => i);
      const capped = capMessagesForMemory(messages);
      expect(capped.messages.length).toBeLessThanOrEqual(300);
      if (n > 300) {
        expect(capped.truncated).toBe(true);
        expect(capped.messages[0]).toBe(n - 300);
      }
    }
  });

  it('DOM render window bounds mounted rows', () => {
    configureAgentResourceLimits({ maxDomRenderMessages: 40 });
    const win = selectMessageRenderWindow(500);
    expect(win.windowed).toBe(true);
    expect(win.end - win.start).toBe(40);
    expect(win.end).toBe(500);
    expect(win.start).toBe(460);
  });
});

describe('P5-004 tool result flood + timeout (A3)', () => {
  it('truncates tool result floods', () => {
    configureAgentResourceLimits({ maxToolResultChars: 200 });
    const flood = 'HEAD:' + 'X'.repeat(9_990) + ':TAIL-STACK-TRACE-ERROR';
    const capped = capToolResultText(flood);
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(200);
    expect(capped.text).toMatch(/truncated/i);
    expect(capped.text.startsWith('HEAD:')).toBe(true);
    expect(capped.text.endsWith(':TAIL-STACK-TRACE-ERROR')).toBe(true);
    expect(capped.originalLength).toBe(flood.length);
  });

  it('keeps both the head and the error tail when truncating large results', () => {
    const text = 'compile-start:' + 'A'.repeat(500) + ':error TS9999: exact failure tail';
    const capped = capToolResultText(text, 128);
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(128);
    expect(capped.text).toContain('compile-start:');
    expect(capped.text).toContain('error TS9999: exact failure tail');
  });

  it('detects turn timeout for abort/release path', () => {
    const started = 1_000_000;
    expect(isTurnTimedOut(started, started + 1000, 5000)).toBe(false);
    expect(isTurnTimedOut(started, started + 5000, 5000)).toBe(true);
    expect(isTurnTimedOut(null, Date.now(), 1000)).toBe(false);
  });
});