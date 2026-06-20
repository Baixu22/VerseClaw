import { describe, expect, it } from 'vitest';
import { createObservabilityTraceRecorder } from '../../openclaw_runtime/src/observability/trace-recorder';
import { aggregateTraceMetrics, buildDashboardSnapshot } from '../../openclaw_runtime/src/observability/metrics';
import { buildTraceScorecard } from '../../openclaw_runtime/src/observability/scorecard';
import {
  completeObservedRun,
  createRoleFirstTrace,
  observedContextPack,
  observedMemoryProposal,
  observedOrchestratorPlan,
  observedRouteRole,
} from '../../openclaw_runtime/src/observability/role-first-observer';
import type { MemoryCard } from '../../openclaw_runtime/src/memory/types';

describe('observability trace recorder MVP', () => {
  it('records trace/span lifecycle, nesting, events, and token metrics', () => {
    let now = 1000;
    let id = 0;
    const recorder = createObservabilityTraceRecorder(
      { name: 'test-run', task: 'observe everything', tags: ['role-first'] },
      { now: () => now, idFactory: (prefix) => `${prefix}_${++id}` },
    );
    const events: string[] = [];
    recorder.subscribe((event) => events.push(event.type));

    const started = recorder.start();
    expect(started.id).toBe('trace_1');
    const parent = recorder.startSpan({ name: 'orchestrator', kind: 'orchestrator' });
    now += 10;
    const child = recorder.startSpan({ name: 'tool:read', kind: 'tool', parentSpanId: parent.id });
    now += 25;
    recorder.endSpan(child.id, {
      tokenUsage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17, costUsd: 0.001 },
    });
    recorder.recordEvent('memory.proposed', 'Proposed memory', { spanId: parent.id, attributes: { accepted: true } });
    now += 5;
    recorder.endSpan(parent.id);
    now += 10;
    const trace = recorder.complete();

    expect(trace.durationMs).toBe(50);
    expect(trace.spans.find((span) => span.id === child.id)?.durationMs).toBe(25);
    expect(trace.tokenUsage.totalTokens).toBe(17);
    expect(trace.events).toHaveLength(1);
    expect(events).toEqual([
      'trace.started',
      'span.started',
      'span.started',
      'span.completed',
      'trace.updated',
      'event.recorded',
      'span.completed',
      'trace.updated',
      'trace.completed',
    ]);
  });

  it('aggregates intuitive quantitative metrics and dashboard cards', () => {
    const recorder = createObservabilityTraceRecorder(
      { name: 'metric-run', mode: 'adversarial-review', tags: ['role-first'] },
      { now: () => 100, idFactory: (prefix) => `${prefix}_metric_${Math.random()}` },
    );
    recorder.start();
    const verifier = recorder.startSpan({ name: 'skeptic', kind: 'verifier', roleName: 'skeptic' });
    recorder.endSpan(verifier.id, { metrics: { findings: 2 } });
    const tool = recorder.startSpan({ name: 'bash', kind: 'tool' });
    recorder.endSpan(tool.id, { status: 'error', error: 'failed' });
    const trace = recorder.complete('error', 'failed');
    const metrics = aggregateTraceMetrics(trace);
    const scorecard = buildTraceScorecard(trace);
    const dashboard = buildDashboardSnapshot([trace], [scorecard], 123);

    expect(metrics.toolCallCount).toBe(1);
    expect(metrics.verifierCount).toBe(1);
    expect(metrics.errorCount).toBeGreaterThan(0);
    expect(scorecard.score).toBeLessThan(90);
    expect(dashboard.cards.map((card) => card.id)).toContain('errors');
    expect(dashboard.alerts.some((alert) => alert.includes('error'))).toBe(true);
  });
});

describe('role-first observability wrappers', () => {
  const card: MemoryCard = {
    id: 'mem_1',
    type: 'project_fact',
    scope: 'project',
    roleTags: ['architect'],
    content: 'Use TypeScript for runtime contracts.',
    evidence: ['package.json'],
    confidence: 0.9,
    importance: 0.9,
    lastAccessedAt: '2026-06-12T00:00:00.000Z',
    createdAt: '2026-06-12T00:00:00.000Z',
    accessCount: 1,
    version: 1,
    status: 'active',
    supersedes: null,
    supersededBy: null,
    expiresAt: null,
  };

  it('captures router, orchestrator, context-pack, and gatekeeper spans with a scorecard', () => {
    let now = 0;
    const recorder = createRoleFirstTrace('安全重构 auth 模块', { mode: 'adversarial-review' });
    const deterministic = createObservabilityTraceRecorder(
      { name: 'role-first-runtime', task: '安全重构 auth 模块', mode: 'adversarial-review', tags: ['role-first'] },
      { now: () => now += 10, idFactory: (prefix) => `${prefix}_${now}` },
    );
    deterministic.start();

    const route = observedRouteRole(deterministic, { task: '安全重构 auth 模块', fileHints: ['auth.ts'] });
    const plan = observedOrchestratorPlan(deterministic, { task: '安全重构 auth 模块', fileHints: ['auth.ts'] });
    const pack = observedContextPack(deterministic, { memories: [card], roleName: route.primary.role.name, taskState: 'Implement MVP observability.' });
    const decision = observedMemoryProposal(deterministic, {
      type: 'project_fact',
      scope: 'project',
      source: 'user',
      content: 'Observability uses trace spans and scorecards.',
      confidence: 0.9,
    }, [], { idFactory: () => 'mem_obs', now: new Date('2026-06-12T00:00:00.000Z') });
    const result = completeObservedRun(deterministic);

    expect(recorder.snapshot().tags).toContain('role-first');
    expect(route.primary.role.name).toBe('security-reviewer');
    expect(plan.mode).toBe('adversarial-review');
    expect(pack.estimatedTokens.total).toBeGreaterThan(0);
    expect(decision.accepted).toBe(true);
    expect(result.trace.spans.map((span) => span.kind)).toEqual([
      'role-router',
      'orchestrator',
      'context-pack',
      'gatekeeper',
    ]);
    expect(result.scorecard.grade).toMatch(/[ABCDF]/);
  });
});
