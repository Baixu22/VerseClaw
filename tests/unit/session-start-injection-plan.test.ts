import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SESSION_START_BUDGET_CHARS,
  SESSION_START_INJECTION_SCHEMA,
  SESSION_START_PRECEDENCE,
  SESSION_START_SOURCE_IDS,
  buildSessionStartInjectionPlan,
  type SessionStartSourceFact,
} from '../../shared/types/session-start-injection';

const fact = (
  sourceId: SessionStartSourceFact['sourceId'],
  chars: number,
  available = true,
): SessionStartSourceFact => ({ sourceId, available, chars });

const ALL_AVAILABLE: SessionStartSourceFact[] = [
  fact('startup-memory', 400),
  fact('continuity-pack', 900),
  fact('handoff-draft', 500),
  fact('fork-inheritance', 300),
];

describe('buildSessionStartInjectionPlan — stage selection', () => {
  it('gives a fresh session startup memory and continuity only', () => {
    const plan = buildSessionStartInjectionPlan({ sessionKey: 'agent:main:main', stage: 'fresh', facts: ALL_AVAILABLE });
    expect(plan.schema).toBe(SESSION_START_INJECTION_SCHEMA);
    expect(plan.items.filter((i) => i.included).map((i) => i.sourceId).sort()).toEqual([
      'continuity-pack',
      'startup-memory',
    ]);
    expect(plan.stageExcluded).toEqual(expect.arrayContaining(['handoff-draft', 'fork-inheritance']));
  });

  it('gives a fork continuity plus inherited context, never startup memory', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'forked', facts: ALL_AVAILABLE });
    const included = plan.items.filter((i) => i.included).map((i) => i.sourceId).sort();
    expect(included).toEqual(['continuity-pack', 'fork-inheritance']);
    expect(plan.items.find((i) => i.sourceId === 'startup-memory')!.reason).toBe('stage-excluded');
  });

  it('gives a handoff continuity plus the draft', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'handedOff', facts: ALL_AVAILABLE });
    expect(plan.items.filter((i) => i.included).map((i) => i.sourceId).sort()).toEqual([
      'continuity-pack',
      'handoff-draft',
    ]);
  });

  it('gives a compacted session continuity and startup memory', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'compacted', facts: ALL_AVAILABLE });
    expect(plan.items.filter((i) => i.included).map((i) => i.sourceId).sort()).toEqual([
      'continuity-pack',
      'startup-memory',
    ]);
  });

  it('gives a continued session no start plan at all', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'continued', facts: ALL_AVAILABLE });
    expect(plan.empty).toBe(true);
    expect(plan.charsApplied).toBe(0);
    expect(plan.items.every((i) => !i.included)).toBe(true);
    expect(plan.items.every((i) => i.reason === 'stage-excluded')).toBe(true);
  });

  it('fails closed for an unknown stage even when every source is available', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'unknown', facts: ALL_AVAILABLE });
    expect(plan.empty).toBe(true);
    expect(plan.items.every((i) => i.reason === 'fail-closed-unknown-stage')).toBe(true);
  });

  it('fails closed when the stage is missing entirely', () => {
    const plan = buildSessionStartInjectionPlan({ stage: null, facts: ALL_AVAILABLE });
    expect(plan.stage).toBe('unknown');
    expect(plan.empty).toBe(true);
  });
});

describe('buildSessionStartInjectionPlan — budget', () => {
  it('applies every source when the budget covers them', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'fresh', facts: [fact('continuity-pack', 900), fact('startup-memory', 400)] });
    expect(plan.charsApplied).toBe(1300);
    expect(plan.charsRemaining).toBe(DEFAULT_SESSION_START_BUDGET_CHARS - 1300);
    expect(plan.empty).toBe(false);
  });

  it('drops the later source when the earlier one already exhausted the budget', () => {
    const plan = buildSessionStartInjectionPlan({
      stage: 'fresh',
      facts: [fact('continuity-pack', 2_800), fact('startup-memory', 400)],
    });
    const startup = plan.items.find((i) => i.sourceId === 'startup-memory')!;
    expect(startup.included).toBe(false);
    expect(startup.reason).toBe('budget-drop');
    expect(plan.charsApplied).toBe(2_800);
  });

  it('records a partial cut instead of silently shortening the last source', () => {
    const plan = buildSessionStartInjectionPlan({
      stage: 'fresh',
      facts: [fact('continuity-pack', 2_000), fact('startup-memory', 1_500)],
    });
    const startup = plan.items.find((i) => i.sourceId === 'startup-memory')!;
    expect(startup.included).toBe(true);
    expect(startup.reason).toBe('budget-partial');
    expect(startup.charsRequested).toBe(1_500);
    expect(startup.charsApplied).toBe(800);
    expect(startup.detail).toContain('700');
  });

  it('honours an explicit budget override', () => {
    const plan = buildSessionStartInjectionPlan({
      stage: 'fresh',
      facts: [fact('continuity-pack', 500), fact('startup-memory', 500)],
      budgetChars: 600,
    });
    expect(plan.budgetChars).toBe(600);
    expect(plan.charsApplied).toBe(600);
  });

  it('keeps the declared precedence order stable', () => {
    expect(SESSION_START_PRECEDENCE[0]).toBe('continuity-pack');
    expect(new Set(SESSION_START_PRECEDENCE).size).toBe(SESSION_START_PRECEDENCE.length);
    expect(SESSION_START_PRECEDENCE.every((id) => SESSION_START_SOURCE_IDS.includes(id))).toBe(true);
  });
});

describe('buildSessionStartInjectionPlan — missing facts', () => {
  it('separates "owner says nothing" from "owner unavailable"', () => {
    const plan = buildSessionStartInjectionPlan({
      stage: 'fresh',
      facts: [fact('continuity-pack', 0), fact('startup-memory', 400, false)],
    });
    expect(plan.items.find((i) => i.sourceId === 'continuity-pack')!.reason).toBe('empty');
    expect(plan.items.find((i) => i.sourceId === 'startup-memory')!.reason).toBe('not-available');
  });

  it('reports a missing owner as not-available rather than empty', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'fresh', facts: [fact('continuity-pack', 100)] });
    expect(plan.items.find((i) => i.sourceId === 'startup-memory')!.reason).toBe('not-available');
  });

  it('carries owner detail through to the plan', () => {
    const plan = buildSessionStartInjectionPlan({
      stage: 'fresh',
      facts: [{ sourceId: 'continuity-pack', available: true, chars: 10, detail: 'continuity pack status: partial' }],
    });
    expect(plan.items.find((i) => i.sourceId === 'continuity-pack')!.detail).toContain('partial');
  });
});

describe('buildSessionStartInjectionPlan — properties', () => {
  it('is pure and does not mutate its facts', () => {
    const facts = [...ALL_AVAILABLE];
    const snapshot = JSON.stringify(facts);
    const first = buildSessionStartInjectionPlan({ stage: 'fresh', facts });
    const second = buildSessionStartInjectionPlan({ stage: 'fresh', facts });
    expect(first).toEqual(second);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });

  it('always accounts for every declared source exactly once', () => {
    const plan = buildSessionStartInjectionPlan({ stage: 'resumed', facts: ALL_AVAILABLE });
    expect(plan.items).toHaveLength(SESSION_START_SOURCE_IDS.length);
    expect(new Set(plan.items.map((i) => i.sourceId))).toEqual(new Set(SESSION_START_SOURCE_IDS));
  });

  it('is serialisable: it carries no text payload for a prompt', () => {
    const plan = buildSessionStartInjectionPlan({ sessionKey: 'agent:main:main', stage: 'fresh', facts: ALL_AVAILABLE });
    const serialised = JSON.stringify(plan);
    // The plan describes intent and sizing; it never carries the content itself.
    expect(Object.keys(plan).sort()).toEqual(
      ['budgetChars', 'charsApplied', 'charsRemaining', 'empty', 'items', 'schema', 'sessionKey', 'stage', 'stageExcluded'].sort(),
    );
    expect(serialised).not.toMatch(/"text"|"prompt"|"content"/);
  });
});
