import { describe, expect, it } from 'vitest';

import {
  OBSERVABILITY_RETENTION_POLICIES,
  TRACE_SPAN_TRUNCATION_THRESHOLD,
  type ObservabilityAreaPrefix,
  type ObservabilityEventName,
  type ObservabilityRetentionPolicy,
  spanDropPriority,
  validateEventNamespace,
} from '../../shared/types/observability';

/**
 * Stage 0 acceptance criterion 0.7 — Observability namespace enforced.
 * A span/event outside the caller's area namespace is rejected.
 *
 * Run: pnpm test observability-namespace
 */
describe('Observability event namespace governance', () => {
  // -------------------------------------------------------------------------
  // Acceptance 0.7: namespace enforcement
  // -------------------------------------------------------------------------

  it('accepts event name in the caller\'s own area namespace', () => {
    expect(validateEventNamespace('claw.a1.snapshot.start', 'a1')).toBeNull();
    expect(validateEventNamespace('claw.a2.wave.deferred', 'a2')).toBeNull();
    expect(validateEventNamespace('claw.a5.budget.plan', 'a5')).toBeNull();
    expect(validateEventNamespace('claw.a6.checkpoint.written', 'a6')).toBeNull();
    expect(validateEventNamespace('claw.a3.anomaly.classified', 'a3')).toBeNull();
    expect(validateEventNamespace('claw.a4.decision.extracted', 'a4')).toBeNull();
  });

  it('acceptance 0.7: rejects event name outside the caller\'s area namespace', () => {
    // A4 trying to emit an A1 event → rejected.
    const error = validateEventNamespace('claw.a1.snapshot.start', 'a4');
    expect(error).not.toBeNull();
    expect(error).toContain('a4');
    expect(error).toContain('claw.a1.');
  });

  it('rejects A2 emitting into A6 namespace', () => {
    const error = validateEventNamespace('claw.a6.checkpoint.pause', 'a2');
    expect(error).not.toBeNull();
    expect(error).toContain('a2');
  });

  it('rejects A1 emitting into A5 namespace', () => {
    const error = validateEventNamespace('claw.a5.budget.pressure', 'a1');
    expect(error).not.toBeNull();
    expect(error).toContain('a1');
  });

  it('rejects event with no area prefix at all', () => {
    expect(validateEventNamespace('random.event.name', 'a1')).not.toBeNull();
    expect(validateEventNamespace('claw.', 'a1')).not.toBeNull();
    expect(validateEventNamespace('', 'a1')).not.toBeNull();
  });

  it('rejects event with wrong prefix (not claw.*)', () => {
    expect(validateEventNamespace('verse.a1.snapshot', 'a1')).not.toBeNull();
    expect(validateEventNamespace('openclaw.a1.snapshot', 'a1')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // core namespace (reserved for Mission Control + existing infra)
  // -------------------------------------------------------------------------

  it('core area accepts claw.core.* events (reserved namespace)', () => {
    expect(validateEventNamespace('claw.core.mission.decision', 'core')).toBeNull();
    expect(validateEventNamespace('claw.core.trace.started', 'core')).toBeNull();
  });

  it('non-core area cannot emit into core namespace', () => {
    expect(validateEventNamespace('claw.core.mission.decision', 'a1')).not.toBeNull();
    expect(validateEventNamespace('claw.core.mission.decision', 'a6')).not.toBeNull();
  });

  it('core area cannot emit into a non-core area namespace', () => {
    // core is reserved; it must use claw.core.*
    expect(validateEventNamespace('claw.a1.snapshot', 'core')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // ObservabilityEventName type (template literal type)
  // -------------------------------------------------------------------------

  it('ObservabilityEventName is a template literal type claw.{area}.{rest}', () => {
    // Type-level smoke: a well-formed name satisfies the type.
    const name: ObservabilityEventName = 'claw.a1.snapshot.start';
    expect(name.startsWith('claw.')).toBe(true);
  });

  it('all 7 area prefixes are valid ObservabilityAreaPrefix values', () => {
    const prefixes: ObservabilityAreaPrefix[] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'core'];
    expect(prefixes).toHaveLength(7);
    // Each prefix produces a valid namespace prefix.
    for (const p of prefixes) {
      const event = `claw.${p}.test.event` as ObservabilityEventName;
      expect(validateEventNamespace(event, p)).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Retention policies
  // -------------------------------------------------------------------------

  it('OBSERVABILITY_RETENTION_POLICIES has 4 categories (decision/diagnostic/error/shadow)', () => {
    expect(OBSERVABILITY_RETENTION_POLICIES).toHaveProperty('decision');
    expect(OBSERVABILITY_RETENTION_POLICIES).toHaveProperty('diagnostic');
    expect(OBSERVABILITY_RETENTION_POLICIES).toHaveProperty('error');
    expect(OBSERVABILITY_RETENTION_POLICIES).toHaveProperty('shadow');
  });

  it('error category has the longest retention (30 days)', () => {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(OBSERVABILITY_RETENTION_POLICIES.error.retentionMs).toBeGreaterThanOrEqual(thirtyDaysMs);
  });

  it('shadow category has the highest throughput sampling (1% above 50/min)', () => {
    expect(OBSERVABILITY_RETENTION_POLICIES.shadow.thresholdPerMinute).toBe(50);
    expect(OBSERVABILITY_RETENTION_POLICIES.shadow.highThroughputSamplingRate).toBeLessThan(1.0);
    expect(OBSERVABILITY_RETENTION_POLICIES.shadow.highThroughputSamplingRate).toBeGreaterThan(0);
  });

  it('decision and error categories never sample down (rate 1.0)', () => {
    expect(OBSERVABILITY_RETENTION_POLICIES.decision.highThroughputSamplingRate).toBe(1.0);
    expect(OBSERVABILITY_RETENTION_POLICIES.error.highThroughputSamplingRate).toBe(1.0);
  });

  it('ObservabilityRetentionPolicy is structural', () => {
    const policy: ObservabilityRetentionPolicy = {
      retentionMs: 1000,
      highThroughputSamplingRate: 0.5,
      thresholdPerMinute: 100,
    };
    expect(policy.retentionMs).toBe(1000);
  });

  // -------------------------------------------------------------------------
  // Trace span truncation
  // -------------------------------------------------------------------------

  it('TRACE_SPAN_TRUNCATION_THRESHOLD is 200', () => {
    expect(TRACE_SPAN_TRUNCATION_THRESHOLD).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Span drop priority (truncation order)
  // -------------------------------------------------------------------------

  it('spanDropPriority: core has highest priority (kept last)', () => {
    expect(spanDropPriority('core')).toBe(0);
  });

  it('spanDropPriority: A6 kept longer than A1 (persistence is critical)', () => {
    expect(spanDropPriority('a6')).toBeLessThan(spanDropPriority('a1'));
  });

  it('spanDropPriority: A4 dropped first (offline-only, lowest priority)', () => {
    expect(spanDropPriority('a4')).toBeGreaterThan(spanDropPriority('a3'));
    expect(spanDropPriority('a3')).toBeGreaterThan(spanDropPriority('a5'));
  });

  it('spanDropPriority order is core < a6 < a1 < a2 < a5 < a3 < a4', () => {
    const order: ObservabilityAreaPrefix[] = ['core', 'a6', 'a1', 'a2', 'a5', 'a3', 'a4'];
    for (let i = 1; i < order.length; i++) {
      expect(spanDropPriority(order[i - 1])).toBeLessThan(spanDropPriority(order[i]));
    }
  });
});
