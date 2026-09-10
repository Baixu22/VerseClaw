import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '../../openclaw_runtime/src/agents/runtime';
import {
  buildContextFamilyPolicyPromotionMetrics,
  buildObservationMaskingProjection,
  estimateLlmBoundaryTokenPressure,
  shouldPreemptivelyCompactBeforePrompt,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction';

function toolResultMessage(text: string, id: string): AgentMessage {
  return {
    role: 'toolResult',
    id,
    content: [{ type: 'text', text }],
    toolCallId: id,
  } as unknown as AgentMessage;
}

describe('Context Family policy promotion', () => {
  it('keeps flag-off routing as the rollback path and records opt-in promotion metrics', async () => {
    const messages = [
      { role: 'user', content: 'inspect archival output' },
      toolResultMessage('old observation\n'.repeat(1_000), 'tool-old'),
      toolResultMessage('new observation\n'.repeat(1_000), 'tool-new'),
    ] as AgentMessage[];
    const baseline = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: '',
      contextTokenBudget: 1_700,
      reserveTokens: 0,
      toolResultMaxChars: 4_000,
    });
    const rollback = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: '',
      contextTokenBudget: 1_700,
      reserveTokens: 0,
      toolResultMaxChars: 4_000,
      observationMasking: {
        enabled: false,
        verifiedMaskedCount: 1,
        projectedPromptTokens: 1_000,
      },
    });
    const projection = await buildObservationMaskingProjection({
      enabled: true,
      messages,
      sessionId: 'session-promotion-1',
      minChars: 1_000,
      preserveNewestObservationCount: 0,
    });
    const promotedTokens = estimateLlmBoundaryTokenPressure({
      messages: projection.messages,
      prompt: '',
    });
    const promoted = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: '',
      contextTokenBudget: 1_700,
      reserveTokens: 0,
      toolResultMaxChars: 4_000,
      observationMasking: {
        enabled: true,
        verifiedMaskedCount: projection.maskedCount,
        projectedPromptTokens: promotedTokens,
      },
    });
    const metrics = buildContextFamilyPolicyPromotionMetrics({
      behavior: 'observation_masking_projection',
      baseline,
      promoted,
      projection,
    });

    expect(rollback.route).toBe(baseline.route);
    expect(rollback.shouldCompact).toBe(baseline.shouldCompact);
    expect(promoted.route).toBe('observation_masking');
    expect(metrics).toMatchObject({
      behavior: 'observation_masking_projection',
      rollbackFlag: 'runtime.contextFamily.observationMasking.enabled=false',
      baselineRoute: baseline.route,
      promotedRoute: 'observation_masking',
      evidenceRetention: {
        archivedHandleCount: 2,
        verifiedMaskedCount: 2,
      },
      recoveryFidelity: {
        recallable: true,
        diagnostics: [],
      },
    });
    expect(metrics.tokenReduction.projectedPromptTokens).toBeLessThan(
      metrics.tokenReduction.baselinePromptTokens,
    );
  });

  it('reports promotion failure modes without claiming recallability', () => {
    const baseline = shouldPreemptivelyCompactBeforePrompt({
      messages: [{ role: 'user', content: 'x' }] as AgentMessage[],
      prompt: 'x'.repeat(8_000),
      contextTokenBudget: 1_000,
      reserveTokens: 0,
    });
    const metrics = buildContextFamilyPolicyPromotionMetrics({
      behavior: 'observation_masking_projection',
      baseline,
      promoted: baseline,
      projection: {
        messages: [],
        maskedCount: 0,
        estimatedTokenReduction: 0,
        diagnostics: ['missing_session_id'],
        archiveHandles: [],
      },
    });

    expect(metrics.recoveryFidelity).toEqual({
      recallable: false,
      diagnostics: ['missing_session_id'],
    });
    expect(metrics.failureModes).toEqual(['missing_session_id']);
  });
});
