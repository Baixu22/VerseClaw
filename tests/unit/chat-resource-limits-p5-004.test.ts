import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAgentResourceLimits, resetAgentResourceLimits } from '../../shared/agent-resource-limits';

const rpc = vi.fn();
const getSessionTokenUsageSummary = vi.fn();

vi.mock('@electron/utils/token-usage', () => ({ getSessionTokenUsageSummary }));
vi.mock('@electron/services/resource-tracker', () => ({
  getResourceTracker: () => ({
    markSessionActive: vi.fn(),
    scanListeningPorts: vi.fn(async () => []),
    watchNewListeningPorts: vi.fn(),
  }),
}));

describe('P5-004 Main-owned chat budget gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentResourceLimits();
  });

  it('uses persisted transcript usage and rejects before Gateway chat.send', async () => {
    configureAgentResourceLimits({ maxSessionTotalTokens: 100, maxSessionCostUsd: 10 });
    getSessionTokenUsageSummary.mockResolvedValue({
      totalTokens: 100,
      estimatedCostUsd: 0.2,
    });
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: { rpc } as never });

    const result = await api.sendWithMedia({
      sessionKey: 'agent:main:budgeted',
      message: 'must not send',
      idempotencyKey: 'budget-denial',
    });

    expect(result).toMatchObject({
      success: false,
      denial: { code: 'TOKEN_BUDGET_EXCEEDED', used: 100, limit: 100 },
    });
    expect(getSessionTokenUsageSummary).toHaveBeenCalledWith('agent:main:budgeted');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects persisted session cost before Gateway chat.send', async () => {
    configureAgentResourceLimits({ maxSessionTotalTokens: 10_000, maxSessionCostUsd: 1 });
    getSessionTokenUsageSummary.mockResolvedValue({
      totalTokens: 10,
      estimatedCostUsd: 1.25,
    });
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: { rpc } as never });

    const result = await api.sendWithMedia({
      sessionKey: 'agent:main:cost-budgeted',
      message: 'must not send',
      idempotencyKey: 'cost-budget-denial',
    });

    expect(result).toMatchObject({
      success: false,
      denial: { code: 'COST_BUDGET_EXCEEDED', used: 1.25, limit: 1 },
    });
    expect(getSessionTokenUsageSummary).toHaveBeenCalledWith('agent:main:cost-budgeted');
    expect(rpc).not.toHaveBeenCalled();
  });
});
