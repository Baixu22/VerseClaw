import { describe, expect, it } from 'vitest';
import {
  composeAgentDevScenario,
  parseAgentDevScenarioExpression,
} from '@shared/agent-dev/scenario-composer';
import { AGENT_DEV_SCENARIO_IDS } from '@shared/agent-dev/scenarios';

describe('agent dev scenario composer', () => {
  it('parses known scenario ids and ignores invalid ids safely', () => {
    expect(parseAgentDevScenarioExpression('doctor-failed+missing+doctor-failed')).toEqual({
      ids: ['doctor-failed'],
      invalidIds: ['missing'],
    });
  });

  it('composes later scenario seeds and query overrides', () => {
    const result = composeAgentDevScenario(
      'chat-streaming+models-heavy-usage+gateway-connecting',
      { gatewayReady: 'override', modelCount: '2' },
    );

    expect(result.ids).toEqual(['chat-streaming', 'models-heavy-usage', 'gateway-connecting']);
    expect(result.route).toBe('/');
    expect(result.seed).toMatchObject({
      gatewayStatus: { state: 'starting', gatewayReady: false },
      usageWindowDays: 30,
      modelCount: '2',
      gatewayReady: 'override',
    });
    expect(result.expression).toBe('chat-streaming+models-heavy-usage+gateway-connecting');
  });

  it('keeps the required scenario registry ids available', () => {
    expect(AGENT_DEV_SCENARIO_IDS).toEqual([
      'chat-empty',
      'chat-streaming',
      'models-heavy-usage',
      'settings-provider-error',
      'doctor-failed',
      'gateway-connecting',
      'knowledge-drafts',
      'observability-trace-errors',
      'transport-fallback-chain',
      'skill-execution-timeout',
      'multi-agent-handoff',
      'knowledge-conflict-merge',
      'channel-reconnect-storm',
      'clawgraph-dag-cycle',
    ]);
  });

  it('composes P0/P1 diagnostic scenarios from the shared registry', () => {
    const result = composeAgentDevScenario(
      'transport-fallback-chain+channel-reconnect-storm',
      { streamDelay: '500', errorAt: '3' },
    );

    expect(result.route).toBe('/settings/channels');
    expect(result.seed).toMatchObject({
      transportFallback: ['ws', 'http', 'ipc'],
      channelReconnects: 8,
      streamDelay: '500',
      errorAt: '3',
    });
  });
});
