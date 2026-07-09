import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../openclaw_runtime/src/agents/runtime';
import {
  buildObservationMaskingProjection,
  shouldPreemptivelyCompactBeforePrompt,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction';

function toolResultMessage(text: string, id: string): AgentMessage {
  return {
    role: 'toolResult',
    id,
    content: [{ type: 'text', text }],
    toolCallId: id,
  } as AgentMessage;
}

describe('Context Family observation masking projection', () => {
  it('keeps legacy routing when observation masking is disabled', () => {
    const messages = [
      { role: 'user', content: 'inspect output' },
      toolResultMessage('x'.repeat(12_000), 'tool-1'),
    ] as AgentMessage[];
    const baseline = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: '',
      contextTokenBudget: 1_200,
      reserveTokens: 0,
      toolResultMaxChars: 4_000,
    });

    const decision = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: '',
      contextTokenBudget: 1_200,
      reserveTokens: 0,
      toolResultMaxChars: 4_000,
      observationMasking: {
        enabled: false,
        projectedPromptTokens: 500,
        verifiedMaskedCount: 1,
      },
    });

    expect(decision.route).toBe(baseline.route);
    expect(decision.shouldCompact).toBe(baseline.shouldCompact);
  });

  it('selects observation_masking only when verified archived observations fit the budget', () => {
    const messages = [
      { role: 'user', content: 'inspect output' },
      toolResultMessage('x'.repeat(12_000), 'tool-1'),
    ] as AgentMessage[];

    const decision = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: '',
      contextTokenBudget: 1_200,
      reserveTokens: 0,
      toolResultMaxChars: 4_000,
      observationMasking: {
        enabled: true,
        projectedPromptTokens: 800,
        verifiedMaskedCount: 1,
      },
    });

    expect(decision.route).toBe('observation_masking');
    expect(decision.shouldCompact).toBe(false);
    expect(decision.observationMasking).toMatchObject({
      verifiedMaskedCount: 1,
      projectedPromptTokens: 800,
    });
  });

  it('masks only old large observation text blocks after archive verification', async () => {
    const originalText = `full output\n${'secret-free-data\n'.repeat(500)}`;
    const newestText = `fresh output\n${'keep-fresh\n'.repeat(500)}`;
    const messages = [
      { role: 'user', content: 'run tools' },
      toolResultMessage(originalText, 'tool-old'),
      { role: 'assistant', content: 'I will inspect it.' },
      toolResultMessage(newestText, 'tool-new'),
      { role: 'user', content: 'do not mask user intent even when long'.repeat(500) },
    ] as AgentMessage[];

    const projection = await buildObservationMaskingProjection({
      enabled: true,
      messages,
      sessionId: 'session-mask-1',
      minChars: 1_000,
      preserveNewestObservationCount: 1,
    });

    expect(projection.maskedCount).toBe(1);
    expect(projection.diagnostics).toEqual([]);
    expect(projection.messages).not.toBe(messages);
    expect(projection.messages[1]).toMatchObject({
      role: 'toolResult',
      id: 'tool-old',
      toolCallId: 'tool-old',
    });
    expect(JSON.stringify(projection.messages[1])).toContain('[Context observation masked]');
    expect(JSON.stringify(projection.messages[1])).toContain('context-archive://session-mask-1/');
    expect(JSON.stringify(projection.messages[1])).not.toContain('secret-free-data');
    expect(JSON.stringify(projection.messages[3])).toContain('keep-fresh');
    expect(JSON.stringify(projection.messages[4])).toContain('do not mask user intent');
    expect(JSON.stringify(messages[1])).toContain('secret-free-data');
  });
});
