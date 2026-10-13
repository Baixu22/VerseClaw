import { describe, expect, it } from 'vitest';
import {
  classifySessionContinuityError,
  resolveSessionContinuityPreflight,
  resolveSessionContinuityRecommendation,
} from '../../src/pages/Chat/session-continuity';

describe('chat session continuity helpers', () => {
  it('recommends Fork by default when the session is idle', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 1000, maxTokens: 100000, truncatedMessageCount: 0, status: 'exact' },
      compactionStatus: {
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

    expect(resolveSessionContinuityPreflight({
      gatewayAvailable: false,
      activeRun: false,
    })).toMatchObject({
      fork: { disabled: true, reasons: ['gateway_unavailable'] },
      handoff: { disabled: false, reasons: ['gateway_unavailable'] },
      recommendation: { action: 'handoff', reason: 'gateway_unavailable', disabled: false },
      health: { status: 'risky', reasons: ['gateway_unavailable'] },
    });
  });

  it('reports continuity health as healthy, risky, or blocked', () => {
    expect(resolveSessionContinuityPreflight({
      gatewayAvailable: true,
      activeRun: false,
    }).health).toEqual({ status: 'healthy', reasons: [] });

    expect(resolveSessionContinuityPreflight({
      gatewayAvailable: true,
      activeRun: false,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 90, maxTokens: 100, truncatedMessageCount: 1, status: 'exact' },
    }).health).toMatchObject({
      status: 'risky',
      reasons: expect.arrayContaining(['high_pressure', 'truncated_context']),
    });

    expect(resolveSessionContinuityPreflight({
      gatewayAvailable: true,
      activeRun: true,
    }).health).toEqual({ status: 'blocked', reasons: ['active_run'] });
  });

  it('recommends Handoff for high context pressure or truncated context', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 90, maxTokens: 100, truncatedMessageCount: 0, status: 'exact' },
    })).toMatchObject({ action: 'handoff', reason: 'high_pressure' });

    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      contextRange: { sessionKey: 'agent:main:main', usedTokens: 10, maxTokens: 100, truncatedMessageCount: 1, status: 'exact' },
    })).toMatchObject({ action: 'handoff', reason: 'truncated_context' });

    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      compactionStatus: {
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

    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      longTaskControlStatus: {
        available: true,
        queueCount: 1,
        warnings: [],
        latestIntervention: {
          id: 'ltie-drain',
          sessionKey: 'agent:main:main',
          trigger: 'queue_drain',
          status: 'draining',
          payload: {},
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })).toEqual({ action: 'fork', reason: 'active_run', disabled: true });
  });

  it('recommends Handoff when a recovery checkpoint is available', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      longTaskControlStatus: {
        available: true,
        queueCount: 0,
        warnings: [],
        latestCheckpoint: {
          id: 'ltcp-1',
          sessionKey: 'agent:main:main',
          trigger: 'compaction',
          status: 'ready',
          checkpoint: {
            schemaVersion: 1,
            trigger: 'compaction',
            openBlockers: [],
            decisions: [],
            deviations: [],
            filesTouched: [],
            testsRun: [],
            reviewNeededItems: [],
            evidenceRefs: [],
            createdAt: new Date(0).toISOString(),
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })).toEqual({ action: 'handoff', reason: 'recovery_checkpoint', disabled: false });
  });

  it('recommends Handoff when recovery context warnings are present', () => {
    expect(resolveSessionContinuityRecommendation({
      gatewayAvailable: true,
      activeRun: false,
      longTaskControlStatus: {
        available: true,
        queueCount: 0,
        warnings: ['recovery_context_available'],
      },
    })).toEqual({ action: 'handoff', reason: 'recovery_context', disabled: false });
  });

  it('classifies actionable failure modes', () => {
    expect(classifySessionContinuityError('Gateway manager unavailable')).toBe('gateway_unavailable');
    expect(classifySessionContinuityError('Parent context is too large to fork')).toBe('parent_too_large');
    expect(classifySessionContinuityError('failed to fork source transcript')).toBe('transcript_unavailable');
    expect(classifySessionContinuityError('cannot fork while the source session has an active run')).toBe('active_run');
    expect(classifySessionContinuityError(
      'Handoff depth 4 exceeds the configured maximum of 3. Converge in the current session instead of relaying again.',
    )).toBe('handoff_depth_exceeded');
    expect(classifySessionContinuityError(
      'Handoff cycle detected: this session already appears in its own handoff ancestry (a -> b -> a).',
    )).toBe('handoff_cycle_detected');
    expect(classifySessionContinuityError('something surprising')).toBe('unknown');
  });
});
