import { describe, expect, it } from 'vitest';

import {
  buildResumeCheckpoint,
  interventionPolicyForInputMode,
  renderResumeCheckpointSummary,
} from '../../shared/types/long-task-control';

describe('long-task intervention control', () => {
  it('maps guide to non-disruptive steering evidence', () => {
    const policy = interventionPolicyForInputMode('guide');

    expect(policy).toMatchObject({
      delivery: 'steer_active_run',
      shouldAbortActiveRun: false,
      mutatesCompletionState: false,
      recordsSteeringEvidence: true,
      recordsDeviation: false,
      checkpointRequired: true,
      resumeTrigger: 'guide',
      taskLedgerEffect: 'evidence',
    });
  });

  it('maps queue to deferred follow-up without aborting the active run', () => {
    const policy = interventionPolicyForInputMode('queue');

    expect(policy).toMatchObject({
      delivery: 'follow_up_after_run',
      shouldAbortActiveRun: false,
      mutatesCompletionState: false,
      recordsSteeringEvidence: false,
      recordsDeviation: false,
      checkpointRequired: true,
      resumeTrigger: 'queue_drain',
      taskLedgerEffect: 'followup',
    });
  });

  it('maps interrupt to deviation evidence and requires ClawGraph confirmation while a node is active', () => {
    const policy = interventionPolicyForInputMode('interrupt', {
      clawGraphNodeActive: true,
      highRisk: true,
    });

    expect(policy).toMatchObject({
      delivery: 'restart_now',
      shouldAbortActiveRun: true,
      mutatesCompletionState: false,
      recordsSteeringEvidence: false,
      recordsDeviation: true,
      checkpointRequired: true,
      reviewRequired: true,
      confirmationRequired: true,
      resumeTrigger: 'interrupt',
      taskLedgerEffect: 'deviation',
    });
  });

  it('builds a normalized resume checkpoint that can recover without the full transcript', () => {
    const checkpoint = buildResumeCheckpoint({
      id: 'checkpoint_1',
      workspaceId: 'workspace',
      sessionKey: 'agent:main:session',
      agentId: 'main',
      trigger: 'interrupt',
      objective: 'Ship long-task controls',
      activeNodeId: 'audit',
      activeTask: 'Audit handoff evidence',
      lastConfirmedHandoff: 'split produced implementation slices',
      openBlockers: ['missing trace evidence', '', 'needs user confirmation'],
      decisions: ['guide-first default'],
      deviations: ['user interrupted active audit'],
      filesTouched: ['src/pages/Chat/index.tsx'],
      testsRun: ['pnpm run typecheck'],
      nextAction: 'resume audit from checkpoint',
      reviewNeededItems: ['confirm interrupted audit state'],
      evidenceRefs: [
        { type: 'clawgraph', ref: 'clawgraph_run_1' },
        { type: 'session', ref: 'agent:main:session' },
      ],
      createdAt: 1_700_000_000_000,
    });

    expect(checkpoint).toMatchObject({
      schemaVersion: 1,
      id: 'checkpoint_1',
      workspaceId: 'workspace',
      trigger: 'interrupt',
      openBlockers: ['missing trace evidence', 'needs user confirmation'],
      decisions: ['guide-first default'],
      deviations: ['user interrupted active audit'],
      evidenceRefs: [
        { type: 'clawgraph', ref: 'clawgraph_run_1' },
        { type: 'session', ref: 'agent:main:session' },
      ],
    });
    expect(checkpoint.createdAt).toBe('2023-11-14T22:13:20.000Z');
    expect(renderResumeCheckpointSummary(checkpoint)).toContain('Next action: resume audit from checkpoint');
    expect(renderResumeCheckpointSummary(checkpoint)).not.toContain('transcript');
  });
});
