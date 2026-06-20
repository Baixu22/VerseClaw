import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import {
  buildHeatGraphDays,
  buildStatusDimensions,
  buildUsageModel,
  extractAssistantBranches,
  extractAssistantReasoning,
  extractAssistantToolFallbacks,
} from '@/components/assistant-render/model';

describe('assistant render model', () => {
  it('extracts branch, reasoning, and fallback tool metadata without runtime coupling', () => {
    const message = {
      role: 'assistant',
      content: 'Primary answer',
      metadata: {
        branches: [
          { id: 'a', label: 'Draft A', text: 'Answer A' },
          { id: 'b', label: 'Draft B', text: 'Answer B' },
        ],
        reasoning: [{ title: 'Summary', summary: 'Checked files and tests.' }],
        toolFallbacks: [{ id: 'tool-1', name: 'unknown_tool', status: 'error', error: 'Missing renderer' }],
      },
    } as RawMessage;

    expect(extractAssistantBranches(message)).toEqual([
      { id: 'a', label: 'Draft A', text: 'Answer A' },
      { id: 'b', label: 'Draft B', text: 'Answer B' },
    ]);
    expect(extractAssistantReasoning(message)).toEqual([
      { id: 'reasoning-1', title: 'Summary', summary: 'Checked files and tests.' },
    ]);
    expect(extractAssistantToolFallbacks(message)).toEqual([
      { id: 'tool-1', name: 'unknown_tool', status: 'error', summary: 'Missing renderer', durationMs: undefined },
    ]);
  });

  it('extracts render metadata from content blocks when history normalization drops top-level extensions', () => {
    const message = {
      role: 'assistant',
      content: [{
        type: 'text',
        text: 'Primary answer',
        assistantRender: {
          branches: ['Answer A', 'Answer B'],
          reasoning: 'Public summary',
          tools: [{ name: 'fallback_tool', status: 'running', input: 'Working' }],
        },
      }],
    } as RawMessage;

    expect(extractAssistantBranches(message)).toHaveLength(2);
    expect(extractAssistantReasoning(message)).toEqual([
      { id: 'reasoning-1', summary: 'Public summary' },
    ]);
    expect(extractAssistantToolFallbacks(message)).toEqual([
      { id: 'tool-1', name: 'fallback_tool', status: 'running', summary: 'Working', durationMs: undefined },
    ]);
  });

  it('builds usage and status models from existing host-api data', () => {
    const usage = buildUsageModel(
      {
        sessionKey: 'agent:main:main',
        inputTokens: 100,
        outputTokens: 40,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        totalTokens: 155,
        estimatedCostUsd: 0.0123,
        updatedAt: 1,
        status: 'streaming',
      },
      { sessionKey: 'agent:main:main', usedTokens: 155, maxTokens: 1000, status: 'exact' },
    );
    expect(usage).toMatchObject({ totalTokens: 155, cacheTokens: 15, maxTokens: 1000, status: 'streaming' });

    const dimensions = buildStatusDimensions({
      gatewayState: 'running',
      sending: true,
      pendingFinal: false,
      activeRunId: 'run-1',
      streamingToolCount: 1,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 900, maxTokens: 1000, status: 'exact' },
      workspaceName: 'Workspace',
      permissionMode: 'plan',
    });
    expect(dimensions.map((item) => [item.id, item.state])).toContainEqual(['context', 'warning']);
    expect(dimensions.map((item) => [item.id, item.state])).toContainEqual(['run', 'active']);
  });

  it('groups recent usage into heatgraph days', () => {
    const today = new Date().toISOString();
    const days = buildHeatGraphDays([
      { timestamp: today, totalTokens: 10 },
      { timestamp: today, totalTokens: 5 },
    ], 3);
    expect(days).toHaveLength(3);
    expect(days.at(-1)).toMatchObject({ count: 2, tokens: 15 });
  });
});
