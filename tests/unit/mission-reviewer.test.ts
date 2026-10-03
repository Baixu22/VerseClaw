import { describe, expect, it } from 'vitest';
import { buildMissionContextPack } from '../../openclaw_runtime/src/agents/mission-control/context';
import {
  parseMissionReviewerResponse,
  runMissionReviewer,
} from '../../openclaw_runtime/src/agents/mission-control/reviewer';

function contextPack() {
  return buildMissionContextPack({
    missionId: 'mission-reviewer',
    objective: 'Ship the feature safely',
    tick: 1,
    evidenceRefs: [{ type: 'task_loop', ref: 'loop-1', summary: 'loop evidence' }],
  });
}

describe('mission reviewer', () => {
  it('parses valid reviewer JSON', () => {
    const parsed = parseMissionReviewerResponse(JSON.stringify({
      decision: 'ask_user',
      confidence: 0.7,
      reason: 'Needs a decision',
      missingEvidence: ['user preference'],
      verificationGaps: ['manual confirmation'],
      repairBrief: 'ask user',
      nextTick: { afterMs: 1000, reason: 'wait' },
      risks: ['ambiguous acceptance'],
      controlSignals: [{
        kind: 'scope_drift',
        severity: 'warning',
        message: 'scope changed',
        suggestedAction: 'ask_user',
        source: 'mission.reviewer',
      }],
      validationState: {
        status: 'partial',
        checks: ['unit test missing'],
        evidenceRefs: [{ type: 'trace', ref: 'trace-1' }],
        summary: 'validation incomplete',
      },
      acceptanceStatus: {
        status: 'changed',
        criteria: ['original acceptance'],
        gaps: ['new acceptance needed'],
      },
      quality: [{
        dimension: 'scope',
        status: 'gap',
        summary: 'scope changed',
        signalKinds: ['scope_drift'],
      }],
      memoryCandidates: [{ kind: 'role_memory', summary: 'Remember this workflow', evidenceRefs: ['trace-1'] }],
      checkpointSummary: 'waiting for user',
    }));

    expect(parsed).toMatchObject({
      decision: 'ask_user',
      confidence: 0.7,
      repairBrief: 'ask user',
      nextTick: { afterMs: 1000, reason: 'wait' },
      memoryCandidates: [{ kind: 'role_memory' }],
    });
    expect(parsed?.controlSignals?.map((signal) => signal.kind)).toContain('scope_drift');
    expect(parsed?.controlSignals?.map((signal) => signal.kind)).toContain('evidence_gap');
    expect(parsed?.controlSignals?.map((signal) => signal.kind)).toContain('validation_missing');
    expect(parsed?.validationState).toMatchObject({ status: 'partial', checks: ['unit test missing'] });
    expect(parsed?.acceptanceStatus).toMatchObject({ status: 'changed', gaps: ['new acceptance needed'] });
    expect(parsed?.quality?.[0]).toMatchObject({ dimension: 'scope', status: 'gap' });
  });

  it('falls back conservatively on invalid JSON', async () => {
    const result = await runMissionReviewer(
      {
        contextPack: contextPack(),
        taskLoopResult: {
          loopRunId: 'loop-1',
          sessionKey: 'agent:main:session',
          task: 'ship',
          status: 'blocked',
          phase: 'blocked',
          iteration: 1,
          maxIterations: 3,
          maxRepairIterations: 2,
          orchestrationRunIds: [],
          evidenceRefs: [],
          risks: [],
          remaining: ['missing tests'],
          nextActions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          iterations: [],
        } as never,
        failures: ['verifier refuted evidence'],
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 3,
        maxTicks: 8,
      },
      { complete: async () => 'not json' },
    );

    expect(result.decision).toBe('repair');
    expect(result.missingEvidence.join(' ')).toContain('verifier refuted evidence');
    expect(result.repairBrief).toContain('Repair Mission tick 1');
  });

  it('does not complete when the inner task loop lacks completion evidence', async () => {
    const result = await runMissionReviewer(
      {
        contextPack: contextPack(),
        taskLoopResult: {
          loopRunId: 'loop-2',
          sessionKey: 'agent:main:session',
          task: 'ship',
          status: 'blocked',
          phase: 'blocked',
          iteration: 1,
          maxIterations: 3,
          maxRepairIterations: 0,
          orchestrationRunIds: [],
          evidenceRefs: [],
          risks: [],
          remaining: ['no verifier output'],
          nextActions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          iterations: [],
        } as never,
        tick: 8,
        repairTicksUsed: 3,
        maxRepairTicks: 3,
        maxTicks: 8,
      },
      { complete: async () => { throw new Error('timeout'); } },
    );

    expect(result.decision).toBe('blocked');
    expect(result.missingEvidence).toContain('no verifier output');
  });

  it('downgrades model complete when acceptance or validation evidence is missing', async () => {
    const result = await runMissionReviewer(
      {
        contextPack: contextPack(),
        taskLoopResult: {
          loopRunId: 'loop-3',
          sessionKey: 'agent:main:session',
          task: 'ship',
          status: 'complete',
          phase: 'complete',
          iteration: 1,
          maxIterations: 3,
          maxRepairIterations: 2,
          orchestrationRunIds: [],
          evidenceRefs: [{ type: 'trace', ref: 'trace-1', summary: 'trace exists' }],
          risks: [],
          remaining: [],
          finalSummary: 'inner loop complete',
          nextActions: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          iterations: [],
        } as never,
        tick: 1,
        repairTicksUsed: 0,
        maxRepairTicks: 3,
        maxTicks: 8,
      },
      {
        complete: async () => JSON.stringify({
          decision: 'complete',
          confidence: 0.95,
          reason: 'looks done',
          missingEvidence: [],
          verificationGaps: [],
          risks: [],
          validationState: { status: 'missing', checks: [], evidenceRefs: [], summary: 'not run' },
          acceptanceStatus: { status: 'missing', criteria: [], gaps: ['acceptance not confirmed'] },
          checkpointSummary: 'claimed complete',
        }),
      },
    );

    expect(result.decision).toBe('repair');
    expect(result.controlSignals?.map((signal) => signal.kind)).toContain('evidence_gap');
    expect(result.validationState?.status).toBe('missing');
    expect(result.repairBrief).toContain('Resolve Mission completion gaps');
  });
});
