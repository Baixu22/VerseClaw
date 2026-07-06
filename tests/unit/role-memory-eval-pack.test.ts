// Area 4 §3.6 — Role Memory eval pack.
//
// Closes the "governance without evaluation" gap by measuring three gates
// against buildContextPack / selectMemoryForContextPack:
//   Gate 1: bucketPrecision  ≥ 0.8  — fixture cards routed to the correct bucket
//   Gate 2: budgetAdherence  = 1.0  — output respects per-bucket + total budgets
//   Gate 3: conflictExclusion = 1.0 — conflict cards only in openConflicts
//
// Fixtures are inline MemoryCard[] literals (no JSON files, no governance
// pipeline) so each test controls the exact sensitivity/type/scope/phaseTags
// combination under test.
//
// Fixture design: taskState = "migration review" and every card's content
// includes "migration" or "review" so taskMatch >= 0.35 for 'may'-class cards
// (fact/episode/preference/handoff) to pass the selection gate. 'must'/'should'
// class cards (constraint/decision/procedure+risk) are selected automatically.

import { describe, it, expect } from 'vitest';
import {
  buildContextPack,
  selectMemoryForContextPack,
} from '../../openclaw_runtime/src/memory/context-pack';
import type { MemoryCard, MemoryCardType, MemoryCardScope, MemoryCardSensitivity, MemoryPhaseTag } from '../../openclaw_runtime/src/memory/types';
import {
  evaluateBucketPrecision,
  evaluateBudgetAdherence,
  evaluateConflictExclusion,
  computeRoleMemoryEvalScore,
  ROLE_MEMORY_EVAL_THRESHOLDS,
  type BucketRoutingAssertion,
} from './helpers/role-memory-eval-score';

const NOW = '2026-07-03T00:00:00.000Z';
const TASK_STATE = 'migration review';

function makeCard(overrides: Partial<MemoryCard> & { id: string; type: MemoryCardType; content: string }): MemoryCard {
  return {
    scope: 'project' as MemoryCardScope,
    roleTags: [],
    evidence: [],
    evidenceRefs: [],
    confidence: 0.9,
    importance: 0.8,
    lastAccessedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    accessCount: 2,
    version: 1,
    status: 'active',
    sensitivity: 'normal' as MemoryCardSensitivity,
    ...overrides,
  };
}

// ── Gate 1: Bucket precision ──────────────────────────────────────────────
//
// Each fixture card exercises one branch of bucketForMemory. Every card's
// content includes "migration" or "review" to ensure taskMatch >= 0.35 for
// 'may'-class cards. The overall precision must be >= 0.8 (spec §3.6).

const BUCKET_PRECISION_FIXTURE: MemoryCard[] = [
  // hardConstraints: sensitivity=secret_adjacent → hardConstraints (content redacted)
  makeCard({ id: 'hc-secret-adjacent', type: 'fact', content: 'API key token=sk-live-1234abcd for the migration review.', sensitivity: 'secret_adjacent' }),
  // hardConstraints: type=constraint → 'must' class (auto-selected)
  makeCard({ id: 'hc-constraint', type: 'constraint', content: 'Never delete user data during migration without review.' }),
  // rolePlaybook: type=procedure → 'should' class (roleApplies=true, auto-selected)
  makeCard({ id: 'rp-procedure', type: 'procedure', content: 'Run migration review checklist before deploying.' }),
  // rolePlaybook: type=preference → 'may' class (taskMatch via "review")
  makeCard({ id: 'rp-preference', type: 'preference', content: 'Prefer TypeScript review for migration scripts.' }),
  // rolePlaybook: type=risk + phase=review → 'should' class
  makeCard({ id: 'rp-risk', type: 'risk', content: 'Schema drift risk during migration if reviews are skipped.', phaseTags: ['review' as MemoryPhaseTag] }),
  // rolePlaybook: type=procedural (legacy) → semanticMemoryType='procedure' → rolePlaybook
  makeCard({ id: 'rp-procedural-legacy', type: 'procedural', content: 'Legacy procedural migration review steps.', roleTags: ['architect'] }),
  // projectFacts: type=fact → 'may' class (taskMatch via "migration")
  makeCard({ id: 'pf-fact', type: 'fact', content: 'The project uses pnpm for migration review.' }),
  // projectFacts: type=decision + importance>=0.7 → 'should' class (auto-selected)
  makeCard({ id: 'pf-decision', type: 'decision', content: 'Adopted the registry pattern for migration review.', importance: 0.85 }),
  // projectFacts: type=project_fact (legacy) → semanticMemoryType='fact' → projectFacts
  makeCard({ id: 'pf-legacy', type: 'project_fact', content: 'The build system supports migration review.' }),
  // teamHandoffs: type=handoff → 'may' class (taskMatch via "migration")
  makeCard({ id: 'th-handoff', type: 'handoff', content: 'Handing off the migration plan for review.' }),
  // teamHandoffs: type=handoff + phaseTags=handoff (phaseTags is redundant but documents intent)
  makeCard({ id: 'th-handoff-phase', type: 'handoff', content: 'Migration handoff review context for receiving role.', phaseTags: ['handoff' as MemoryPhaseTag] }),
  // recentEpisodes: type=episode → 'may' class (taskMatch via "migration")
  makeCard({ id: 're-episode', type: 'episode', content: 'User asked about the migration rollback review yesterday.' }),
  // recentEpisodes: type=episodic (legacy) → semanticMemoryType='episode' → recentEpisodes
  makeCard({ id: 're-legacy', type: 'episodic', content: 'Session discussed the migration review strategy.' }),
  // recentEpisodes: type=episode + scope=session (scope is redundant but documents intent)
  makeCard({ id: 're-episode-session', type: 'episode', content: 'Current session migration review exploration.', scope: 'session' }),
];

const BUCKET_PRECISION_ASSERTIONS: BucketRoutingAssertion[] = [
  { cardId: 'hc-secret-adjacent', expectedBucket: 'hardConstraints' },
  { cardId: 'hc-constraint', expectedBucket: 'hardConstraints' },
  { cardId: 'rp-procedure', expectedBucket: 'rolePlaybook' },
  { cardId: 'rp-preference', expectedBucket: 'rolePlaybook' },
  { cardId: 'rp-risk', expectedBucket: 'rolePlaybook' },
  { cardId: 'rp-procedural-legacy', expectedBucket: 'rolePlaybook' },
  { cardId: 'pf-fact', expectedBucket: 'projectFacts' },
  { cardId: 'pf-decision', expectedBucket: 'projectFacts' },
  { cardId: 'pf-legacy', expectedBucket: 'projectFacts' },
  { cardId: 'th-handoff', expectedBucket: 'teamHandoffs' },
  { cardId: 'th-handoff-phase', expectedBucket: 'teamHandoffs' },
  { cardId: 're-episode', expectedBucket: 'recentEpisodes' },
  { cardId: 're-legacy', expectedBucket: 'recentEpisodes' },
  { cardId: 're-episode-session', expectedBucket: 'recentEpisodes' },
];

describe('Area 4 §3.6 — Role Memory eval pack', () => {
  describe('Gate 1: bucket precision (≥ 0.8)', () => {
    it('routes all fixture cards to the correct bucket (roleName=architect)', () => {
      const { explanations } = selectMemoryForContextPack({
        memories: BUCKET_PRECISION_FIXTURE,
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const result = evaluateBucketPrecision(explanations, BUCKET_PRECISION_ASSERTIONS);
      // Log details for debugging when the test fails.
      if (!result.passed) {
        const mismatches = explanations
          .filter((exp) => {
            const assertion = BUCKET_PRECISION_ASSERTIONS.find((a) => a.cardId === exp.cardId);
            return assertion && (!exp.selected || exp.bucket !== assertion.expectedBucket);
          })
          .map((exp) => `${exp.cardId}: selected=${exp.selected}, bucket=${exp.bucket}`);
        console.error('Bucket precision mismatches:', mismatches);
      }
      expect(result.value).toBeGreaterThanOrEqual(ROLE_MEMORY_EVAL_THRESHOLDS.bucketPrecision);
      expect(result.passed).toBe(true);
    });

    it('routes secret-adjacent card to hardConstraints with redacted content', () => {
      const { selected } = selectMemoryForContextPack({
        memories: [BUCKET_PRECISION_FIXTURE[0]],
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const entry = selected.find((item) => item.card.id === 'hc-secret-adjacent');
      expect(entry).toBeDefined();
      expect(entry?.bucket).toBe('hardConstraints');
      // redactMemoryContent replaces token=... with token=[redacted]
      expect(entry?.text).toContain('[redacted]');
      expect(entry?.text).not.toContain('sk-live-1234abcd');
    });

    it('routes constraint card to hardConstraints even with normal sensitivity', () => {
      const { selected } = selectMemoryForContextPack({
        memories: [BUCKET_PRECISION_FIXTURE[1]],
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const entry = selected.find((item) => item.card.id === 'hc-constraint');
      expect(entry).toBeDefined();
      expect(entry?.bucket).toBe('hardConstraints');
    });

    it('routes handoff card with phaseTags to teamHandoffs', () => {
      const { selected } = selectMemoryForContextPack({
        memories: [BUCKET_PRECISION_FIXTURE[10]], // th-handoff-phase
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const entry = selected.find((item) => item.card.id === 'th-handoff-phase');
      expect(entry).toBeDefined();
      expect(entry?.bucket).toBe('teamHandoffs');
    });

    it('routes procedural (legacy) card to rolePlaybook via normalizeMemoryType', () => {
      const { selected } = selectMemoryForContextPack({
        memories: [BUCKET_PRECISION_FIXTURE[5]], // rp-procedural-legacy
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const entry = selected.find((item) => item.card.id === 'rp-procedural-legacy');
      expect(entry).toBeDefined();
      expect(entry?.bucket).toBe('rolePlaybook');
    });

    it('routes episode card with scope=session to recentEpisodes', () => {
      const { selected } = selectMemoryForContextPack({
        memories: [BUCKET_PRECISION_FIXTURE[13]], // re-episode-session, scope=session
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const entry = selected.find((item) => item.card.id === 're-episode-session');
      expect(entry).toBeDefined();
      expect(entry?.bucket).toBe('recentEpisodes');
    });

    it('routes role_experience (legacy) to rolePlaybook via normalizeMemoryType', () => {
      // role_experience → normalizeMemoryType → 'procedure' → rolePlaybook
      const card = makeCard({ id: 'legacy-role-exp', type: 'role_experience', content: 'Past migration review experience with the routing system.' });
      const { selected } = selectMemoryForContextPack({
        memories: [card],
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const entry = selected.find((item) => item.card.id === 'legacy-role-exp');
      expect(entry).toBeDefined();
      expect(entry?.bucket).toBe('rolePlaybook');
    });
  });

  // ── Gate 2: Budget adherence (100%) ──────────────────────────────────────
  describe('Gate 2: budget adherence (100%)', () => {
    it('respects default total budget when fixture is small', () => {
      const pack = buildContextPack({
        memories: BUCKET_PRECISION_FIXTURE,
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const result = evaluateBudgetAdherence(pack);
      expect(result.passed).toBe(true);
      expect(pack.estimatedTokens.total).toBeLessThanOrEqual(pack.budget.total);
    });

    it('respects per-bucket budget when one bucket overflows', () => {
      // Generate 20 constraint cards, each ~40 tokens, total ~800 tokens
      // but hardConstraints budget is 500. The overflow should be truncated,
      // and estimatedTokens.hardConstraints must stay <= 500.
      const overflowCards: MemoryCard[] = Array.from({ length: 20 }, (_, idx) =>
        makeCard({
          id: `overflow-hc-${idx}`,
          type: 'constraint',
          content: `Constraint number ${idx}: this is a long constraint statement that should consume approximately forty tokens when rendered into the context pack budget calculator.`,
        }),
      );
      const pack = buildContextPack({
        memories: overflowCards,
        roleName: 'architect',
      });
      const result = evaluateBudgetAdherence(pack);
      expect(result.passed).toBe(true);
      expect(pack.estimatedTokens.hardConstraints).toBeLessThanOrEqual(pack.budget.hardConstraints);
      expect(pack.truncated).toBe(true);
    });

    it('respects total budget when all buckets combined overflow', () => {
      // Generate cards across all buckets that together exceed total=3000.
      const cards: MemoryCard[] = [
        // 10 constraints (~400 tokens)
        ...Array.from({ length: 10 }, (_, idx) =>
          makeCard({
            id: `total-hc-${idx}`,
            type: 'constraint',
            content: `Hard constraint ${idx}: this is a lengthy constraint statement designed to consume tokens in the budget calculation for the total budget adherence test scenario.`,
          }),
        ),
        // 10 facts (~400 tokens)
        ...Array.from({ length: 10 }, (_, idx) =>
          makeCard({
            id: `total-pf-${idx}`,
            type: 'fact',
            content: `Project fact ${idx}: this is a detailed fact statement about the project that should consume tokens in the total budget calculation for the adherence test scenario.`,
          }),
        ),
        // 10 procedures (~400 tokens)
        ...Array.from({ length: 10 }, (_, idx) =>
          makeCard({
            id: `total-rp-${idx}`,
            type: 'procedure',
            content: `Procedure ${idx}: this is a step-by-step procedure description that should consume tokens in the role playbook budget for the total adherence test.`,
          }),
        ),
        // 10 episodes (~400 tokens)
        ...Array.from({ length: 10 }, (_, idx) =>
          makeCard({
            id: `total-re-${idx}`,
            type: 'episode',
            content: `Episode ${idx}: this is a recent episode description about what happened in the session that should consume tokens in the recent episodes budget.`,
          }),
        ),
      ];
      const pack = buildContextPack({
        memories: cards,
        roleName: 'architect',
        taskState: 'project fact procedure episode constraint session',
      });
      const result = evaluateBudgetAdherence(pack);
      expect(result.passed).toBe(true);
      expect(pack.estimatedTokens.total).toBeLessThanOrEqual(pack.budget.total);
    });

    it('respects custom reduced budget and truncates', () => {
      const pack = buildContextPack({
        memories: BUCKET_PRECISION_FIXTURE,
        roleName: 'architect',
        taskState: TASK_STATE,
        budget: {
          hardConstraints: 50,
          rolePlaybook: 50,
          projectFacts: 50,
          teamHandoffs: 50,
          recentEpisodes: 50,
          openConflicts: 50,
          taskState: 50,
          total: 100,
        },
      });
      const result = evaluateBudgetAdherence(pack);
      expect(result.passed).toBe(true);
      expect(pack.estimatedTokens.total).toBeLessThanOrEqual(100);
      // With 14 cards and only 100 total tokens, at least some must be truncated.
      expect(pack.truncated).toBe(true);
    });

    it('taskState text respects taskState budget', () => {
      const longTaskState = 'Task state '.repeat(500); // ~550 tokens
      const pack = buildContextPack({
        memories: [],
        roleName: 'architect',
        taskState: longTaskState,
      });
      const result = evaluateBudgetAdherence(pack);
      expect(result.passed).toBe(true);
      expect(pack.estimatedTokens.taskState).toBeLessThanOrEqual(pack.budget.taskState);
    });
  });

  // ── Gate 3: Conflict exclusion (100%) ─────────────────────────────────────
  describe('Gate 3: conflict exclusion (100%)', () => {
    it('routes conflict card exclusively to openConflicts via openConflictCardIds', () => {
      const conflictCard = makeCard({
        id: 'conflict-1',
        type: 'fact',
        content: 'This fact conflicts with an existing migration review memory.',
      });
      const normalCard = makeCard({
        id: 'normal-1',
        type: 'fact',
        content: 'This is a normal non-conflicting migration review fact.',
      });
      const { explanations } = selectMemoryForContextPack({
        memories: [conflictCard, normalCard],
        roleName: 'architect',
        taskState: TASK_STATE,
        openConflictCardIds: ['conflict-1'],
      });
      const result = evaluateConflictExclusion(explanations, ['conflict-1']);
      expect(result.passed).toBe(true);
      expect(result.value).toBe(1.0);

      // The conflict card must be in openConflicts, the normal card in projectFacts.
      const conflictExp = explanations.find((e) => e.cardId === 'conflict-1');
      expect(conflictExp?.selected).toBe(true);
      expect(conflictExp?.bucket).toBe('openConflicts');
      const normalExp = explanations.find((e) => e.cardId === 'normal-1');
      expect(normalExp?.selected).toBe(true);
      expect(normalExp?.bucket).toBe('projectFacts');
    });

    it('does not leak conflict card into its natural bucket', () => {
      // A constraint card would naturally go to hardConstraints, but if it is
      // in openConflictCardIds it must go to openConflicts instead.
      const conflictConstraint = makeCard({
        id: 'conflict-constraint',
        type: 'constraint',
        content: 'Conflicting constraint that should be routed to openConflicts for review.',
      });
      const { explanations } = selectMemoryForContextPack({
        memories: [conflictConstraint],
        roleName: 'architect',
        taskState: TASK_STATE,
        openConflictCardIds: ['conflict-constraint'],
      });
      const result = evaluateConflictExclusion(explanations, ['conflict-constraint']);
      expect(result.passed).toBe(true);
      const exp = explanations.find((e) => e.cardId === 'conflict-constraint');
      expect(exp?.bucket).toBe('openConflicts');
      expect(exp?.bucket).not.toBe('hardConstraints');
    });

    it('applies conflict penalty to score (conflict card scores lower)', () => {
      // Use constraint type so BOTH cards are 'must' class (classRank=3).
      // The conflict card gets -0.4 penalty; the base card does not.
      // Same classRank means the only difference is the conflict penalty.
      const baseCard = makeCard({
        id: 'base-constraint',
        type: 'constraint',
        content: 'Base constraint for migration review score comparison.',
        importance: 0.8,
        confidence: 0.9,
      });
      const conflictCard = makeCard({
        id: 'conflict-constraint-score',
        type: 'constraint',
        content: 'Base constraint for migration review score comparison.', // identical content
        importance: 0.8,
        confidence: 0.9,
      });
      const { explanations } = selectMemoryForContextPack({
        memories: [baseCard, conflictCard],
        roleName: 'architect',
        taskState: TASK_STATE,
        openConflictCardIds: ['conflict-constraint-score'],
      });
      const baseScore = explanations.find((e) => e.cardId === 'base-constraint')?.score ?? 0;
      const conflictScore = explanations.find((e) => e.cardId === 'conflict-constraint-score')?.score ?? 0;
      // Both are 'must' class (classRank=3), so the only score difference is
      // the -0.4 conflict penalty on the conflict card.
      expect(conflictScore).toBeLessThan(baseScore);
      expect(baseScore - conflictScore).toBeCloseTo(0.4, 1);
    });

    it('openConflicts text from input.openConflicts is also budgeted', () => {
      const pack = buildContextPack({
        memories: [],
        roleName: 'architect',
        openConflicts: ['Conflict description one.', 'Conflict description two.'],
      });
      const result = evaluateBudgetAdherence(pack);
      expect(result.passed).toBe(true);
      expect(pack.buckets.openConflicts.length).toBe(2);
    });

    it('vacuously passes when no conflict cards are present', () => {
      const { explanations } = selectMemoryForContextPack({
        memories: BUCKET_PRECISION_FIXTURE,
        roleName: 'architect',
        taskState: TASK_STATE,
      });
      const result = evaluateConflictExclusion(explanations, []);
      expect(result.passed).toBe(true);
      expect(result.value).toBe(1.0);
    });
  });

  // ── Aggregate score ───────────────────────────────────────────────────────
  describe('Aggregate eval score', () => {
    it('all three gates pass on the full fixture suite', () => {
      const conflictCard = makeCard({
        id: 'agg-conflict',
        type: 'fact',
        content: 'A conflicting migration review fact for the aggregate test.',
      });
      const memories = [...BUCKET_PRECISION_FIXTURE, conflictCard];
      const pack = buildContextPack({
        memories,
        roleName: 'architect',
        taskState: TASK_STATE,
        openConflictCardIds: ['agg-conflict'],
        openConflicts: ['Existing conflict context.'],
      });
      const { explanations } = selectMemoryForContextPack({
        memories,
        roleName: 'architect',
        taskState: TASK_STATE,
        openConflictCardIds: ['agg-conflict'],
      });

      const precision = evaluateBucketPrecision(explanations, BUCKET_PRECISION_ASSERTIONS);
      const budget = evaluateBudgetAdherence(pack);
      const conflict = evaluateConflictExclusion(explanations, ['agg-conflict']);
      const score = computeRoleMemoryEvalScore([precision, budget, conflict]);

      expect(score.passed).toBe(true);
      expect(score.disqualifiers).toEqual([]);
      expect(score.overall).toBeGreaterThanOrEqual(0.8);
    });
  });
});
