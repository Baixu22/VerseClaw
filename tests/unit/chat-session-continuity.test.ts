import { describe, expect, it } from 'vitest';
import {
  classifySessionContinuityError,
  resolveSessionContinuityRecommendation,
} from '../../src/pages/Chat/session-continuity';

describe('chat session continuity helpers', () => {
  it('recommends Fork by default when the session is idle', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 1000, maxTokens: 100000, truncatedMessageCount: 0 },
      compactionStatus: {
        success: true,
        available: true,
        canCompact: true,
        inProgress: false,
        pressure: 'low',
        truncatedMessageCount: 0,
        warnings: [],
      },
    })).toEqual({ action: 'fork', reason: 'default', disabled: false });
  });

  it('recommends Handoff when Gateway is unavailable', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: false,
      activeRun: false,
    })).toEqual({ action: 'handoff', reason: 'gateway_unavailable', disabled: false });
  });

  it('recommends Handoff for high context pressure or truncated context', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 90, maxTokens: 100, truncatedMessageCount: 0 },
    })).toMatchObject({ action: 'handoff', reason: 'high_pressure' });

    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 10, maxTokens: 100, truncatedMessageCount: 1 },
    })).toMatchObject({ action: 'handoff', reason: 'truncated_context' });

    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      compactionStatus: {
        success: true,
        available: true,
        canCompact: true,
        inProgress: false,
        pressure: 'high',
        truncatedMessageCount: 0,
        warnings: [],
      },
    })).toMatchObject({ action: 'handoff', reason: 'high_pressure' });
  });

  it('marks both continuity actions disabled while a run is active', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: true,
    })).toEqual({ action: 'fork', reason: 'active_run', disabled: true });
  });

  it('classifies actionable failure modes', () => {
    expect(classifySessionContinuityError('Gateway manager unavailable')).toBe('gateway_unavailable');
    expect(classifySessionContinuityError('Parent context is too large to fork')).toBe('parent_too_large');
    expect(classifySessionContinuityError('failed to fork source transcript')).toBe('transcript_unavailable');
    expect(classifySessionContinuityError('cannot fork while the source session has an active run')).toBe('active_run');
    expect(classifySessionContinuityError('something surprising')).toBe('unknown');
  });
});
