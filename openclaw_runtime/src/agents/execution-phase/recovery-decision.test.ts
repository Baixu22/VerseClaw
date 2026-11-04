import { describe, expect, it } from 'vitest';

import {
  buildToolIntentRecord,
  decideExecutionRecovery,
  deriveEffectCertainty,
  isIntentBeforeEffect,
  type EffectFacts,
} from './recovery-decision.js';

function effectFacts(overrides: Partial<EffectFacts> = {}): EffectFacts {
  return { intentRecorded: true, journalMatches: 0, receiptOutcomes: [], ...overrides };
}

describe('TF-0718 effect certainty from the domain journal', () => {
  it('treats a journal match as applied', () => {
    expect(deriveEffectCertainty(effectFacts({ journalMatches: 1 }))).toBe('applied');
  });

  it('never promotes a receipt to applied without the journal', () => {
    expect(deriveEffectCertainty(effectFacts({ receiptOutcomes: ['applied'] }))).toBe('unknown');
  });

  it('reads a fully negative receipt set as not applied', () => {
    expect(deriveEffectCertainty(effectFacts({ receiptOutcomes: ['not_applied'] }))).toBe('not_applied');
  });

  it('is unknown when only an intent exists, and not applied when nothing exists', () => {
    expect(deriveEffectCertainty(effectFacts())).toBe('unknown');
    expect(deriveEffectCertainty(effectFacts({ intentRecorded: false }))).toBe('not_applied');
  });
});

describe('TF-0719 recovery decisions match the committed phase (K1-K5)', () => {
  it('K1: admitted + not applied -> resume dispatch', () => {
    const decision = decideExecutionRecovery('admitted', 'not_applied');
    expect(decision.action).toBe('resume-dispatch');
    expect(decision.replayAllowed).toBe(true);
  });

  it('K2: dispatched + not applied -> reconcile, never dispatch twice', () => {
    const decision = decideExecutionRecovery('dispatched', 'not_applied');
    expect(decision.action).toBe('reconcile');
    expect(decision.replayAllowed).toBe(false);
  });

  it('K3: effect_pending + unknown -> quarantine', () => {
    const decision = decideExecutionRecovery('effect_pending', 'unknown');
    expect(decision.action).toBe('quarantine');
    expect(decision.replayAllowed).toBe(false);
    expect(decision.evidenceRequired).toContain('domain-journal');
  });

  it('K4: effect_pending + applied -> advance the commit, do not re-run', () => {
    const decision = decideExecutionRecovery('effect_pending', 'applied');
    expect(decision.action).toBe('advance-commit');
    expect(decision.replayAllowed).toBe(false);
  });

  it('K5: effect_committed + applied -> continue verification only', () => {
    const committed = decideExecutionRecovery('effect_committed', 'applied');
    expect(committed.action).toBe('advance-commit');
    expect(committed.replayAllowed).toBe(false);
    const verified = decideExecutionRecovery('verified', 'not_applied');
    expect(verified.action).toBe('settle');
    expect(verified.replayAllowed).toBe(false);
  });

  it('never allows replay when the effect may already be present', () => {
    for (const phase of ['dispatched', 'effect_pending', 'effect_committed'] as const) {
      for (const effect of ['applied', 'unknown', 'reconciled'] as const) {
        expect(decideExecutionRecovery(phase, effect).replayAllowed).toBe(false);
      }
    }
  });
});

describe('TF-0718 tool intent ordering', () => {
  it('builds a dispatched intent keyed by the idempotency key', () => {
    const intent = buildToolIntentRecord({ idempotencyKey: 'k-1', toolName: 'bash', now: 100 });
    expect(intent.phase).toBe('dispatched');
    expect(intent.intentId).toBe('intent:k-1');
  });

  it('accepts an intent recorded before the effect and rejects one recorded after', () => {
    const intent = buildToolIntentRecord({ idempotencyKey: 'k-1', toolName: 'bash', now: 100 });
    expect(isIntentBeforeEffect(intent, 100)).toBe(true);
    expect(isIntentBeforeEffect(intent, 99)).toBe(false);
    expect(isIntentBeforeEffect(undefined, 100)).toBe(false);
  });
});
