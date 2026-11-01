import { describe, expect, it } from 'vitest';

import {
  SESSION_STAGE_SCHEMA,
  SESSION_STAGES,
  deriveSessionStage,
  type SessionStageFacts,
} from '../../shared/types/session-stage';
import { projectSessionStage } from '../../openclaw_runtime/src/gateway/server-methods/session-stage-projection';

const base: SessionStageFacts = { sessionKey: 'agent:main:main', sessionId: 'sid-1' };

describe('deriveSessionStage', () => {
  it('returns fresh for an identified session with no rotation or activity proof', () => {
    const out = deriveSessionStage(base);
    expect(out.schema).toBe(SESSION_STAGE_SCHEMA);
    expect(out.stage).toBe('fresh');
    expect(out.identity).toEqual({ sessionKey: 'agent:main:main', sessionId: 'sid-1' });
  });

  it('returns unknown, not fresh, when the session has no identity at all', () => {
    const out = deriveSessionStage({});
    expect(out.stage).toBe('unknown');
    expect(out.stageEvidence.reasons).toContain('no-session-identity');
    expect(out.stageEvidence.missingFacts).toEqual(expect.arrayContaining(['sessionKey', 'sessionId']));
  });

  it('prefers forked over handedOff when a full fork triple is present', () => {
    const out = deriveSessionStage({
      ...base,
      forkedFromParent: true,
      forkedFromLeafId: 'leaf-9',
      forkedFromTimestamp: 1_700_000_000_000,
      parentSessionKey: 'agent:main:parent',
      compactionCount: 3,
    });
    expect(out.stage).toBe('forked');
    expect(out.stageEvidence.reasons).toContain('fork-triple');
  });

  it('treats a fork leaf id with no parent key as contradictory instead of forked', () => {
    const out = deriveSessionStage({ ...base, forkedFromLeafId: 'leaf-9' });
    expect(out.stage).toBe('unknown');
    expect(out.stageEvidence.reasons).toContain('conflicting-fork-facts');
  });

  it('returns handedOff for a parent key without fork facts', () => {
    const out = deriveSessionStage({ ...base, parentSessionKey: 'agent:main:parent' });
    expect(out.stage).toBe('handedOff');
  });

  it('returns handedOff for a spawned child session', () => {
    const out = deriveSessionStage({ ...base, spawnedBy: 'agent:main:parent' });
    expect(out.stage).toBe('handedOff');
  });

  it('returns restored when the usage family holds an earlier generation', () => {
    const out = deriveSessionStage({
      ...base,
      usageFamilyKey: 'family-1',
      usageFamilySessionIds: ['sid-0', 'sid-1'],
    });
    expect(out.stage).toBe('restored');
    expect(out.stageEvidence.usedFacts).toEqual(expect.arrayContaining(['usageFamilySessionIds']));
  });

  it('does not report restored for a family that only contains the current generation', () => {
    const out = deriveSessionStage({ ...base, usageFamilySessionIds: ['sid-1'] });
    expect(out.stage).not.toBe('restored');
  });

  it('returns compacted for a compaction count', () => {
    expect(deriveSessionStage({ ...base, compactionCount: 1 }).stage).toBe('compacted');
  });

  it('returns compacted for a retained compaction checkpoint', () => {
    expect(deriveSessionStage({ ...base, hasCompactionCheckpoint: true }).stage).toBe('compacted');
  });

  it('returns resumed only when activity is far past session start', () => {
    const started = 1_700_000_000_000;
    const resumed = deriveSessionStage({
      ...base,
      sessionStartedAt: started,
      lastTranscriptActivityAt: started + 7 * 60 * 60 * 1000,
    });
    expect(resumed.stage).toBe('resumed');

    const sameRun = deriveSessionStage({
      ...base,
      sessionStartedAt: started,
      lastTranscriptActivityAt: started + 60_000,
    });
    expect(sameRun.stage).toBe('continued');
  });

  it('returns continued when the transcript has activity inside one run window', () => {
    const out = deriveSessionStage({ ...base, hasTranscriptActivity: true });
    expect(out.stage).toBe('continued');
    expect(out.stageEvidence.reasons).toContain('transcript-activity');
  });

  it('covers every declared stage value across the rule set', () => {
    const stages = new Set<string>([
      deriveSessionStage(base).stage,
      deriveSessionStage({ ...base, hasTranscriptActivity: true }).stage,
      deriveSessionStage({ ...base, compactionCount: 1 }).stage,
      deriveSessionStage({ ...base, forkedFromParent: true }).stage,
      deriveSessionStage({ ...base, parentSessionKey: 'p' }).stage,
      deriveSessionStage({ ...base, usageFamilySessionIds: ['other'] }).stage,
      deriveSessionStage({ sessionKey: 'k', sessionStartedAt: 1, lastTranscriptActivityAt: 1 + 7 * 60 * 60 * 1000 }).stage,
      deriveSessionStage({}).stage,
    ]);
    for (const stage of SESSION_STAGES) expect(stages.has(stage)).toBe(true);
  });

  it('is pure: the same facts produce the same projection and the input is not mutated', () => {
    const facts: SessionStageFacts = { ...base, parentSessionKey: 'agent:main:parent' };
    const snapshot = JSON.stringify(facts);
    const first = deriveSessionStage(facts);
    const second = deriveSessionStage(facts);
    expect(first).toEqual(second);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});

describe('projectSessionStage', () => {
  it('maps a missing session entry to unknown rather than fresh', () => {
    const out = projectSessionStage({ sessionKey: 'agent:main:main', entry: null });
    expect(out.stage).toBe('unknown');
  });

  it('maps entry compaction checkpoints without opening the transcript', () => {
    const out = projectSessionStage({
      sessionKey: 'agent:main:main',
      entry: { sessionId: 'sid-1', compactionCheckpoints: [{ id: 'cp-1' }] },
    });
    expect(out.stage).toBe('compacted');
  });

  it('passes transcript activity through to the projection', () => {
    const out = projectSessionStage({
      sessionKey: 'agent:main:main',
      entry: { sessionId: 'sid-1' },
      hasTranscriptActivity: true,
    });
    expect(out.stage).toBe('continued');
  });

  it('reads identity from the session key and entry only', () => {
    const out = projectSessionStage({
      sessionKey: 'agent:main:main',
      entry: { sessionId: 'sid-1' },
    });
    expect(out.identity.sessionKey).toBe('agent:main:main');
    expect(out.identity.sessionId).toBe('sid-1');
  });
});
