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
        },
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
        },
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
});
