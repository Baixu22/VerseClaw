import { describe, expect, it } from 'vitest';
import {
  buildCvkEvalReport,
  calculateRate,
  calculateTokenSavingRate,
  scanGeneratedArtifactSecrets,
} from '../../openclaw_runtime/src/context-engine/cvk/eval-report';

const PASSING_METRICS = {
  TSR: 0.65,
  CRR: 0.82,
  SC: 1,
  SS: 1,
  AR: 1,
  RRR: 1,
  HCR: 0.99,
  UCR: 0,
  ERR: 1,
  RFS: 0.96,
  ToolCallValidity: 0.99,
};

const REQUIRED_BENCHMARKS = [
  'tool_schema',
  'skill_routing',
  'project_rule',
  'codebase',
  'compact_recovery',
] as const;

describe('Context Runtime Kit eval reporting', () => {
  it('calculates metric formulas deterministically', () => {
    expect(calculateRate(95, 100)).toBe(0.95);
    expect(calculateRate(0, 0)).toBe(1);
    expect(calculateTokenSavingRate(1000, 400)).toBe(0.6);
  });

  it('reports averages, worst-case failures, gate summaries, and Level 1/2/3 decisions', () => {
    const report = buildCvkEvalReport({
      benchmarks: REQUIRED_BENCHMARKS.map((benchmark) => ({
        id: `${benchmark}-fixture`,
        benchmark,
        metrics: benchmark === 'project_rule'
          ? { ...PASSING_METRICS, HCR: 0.94 }
          : PASSING_METRICS,
        failures: benchmark === 'project_rule'
          ? ['Project rule HCR fell below Level 1 threshold.']
          : [],
      })),
      generatedArtifacts: [{
        path: 'artifacts/context-runtime-kit/report.json',
        content: '{"ok":true}',
      }],
    });

    expect(report.averages.HCR).toBeLessThan(0.99);
    expect(report.worstCaseFailures).toEqual([
      expect.objectContaining({
        benchmark: 'project_rule',
        failures: ['Project rule HCR fell below Level 1 threshold.'],
      }),
    ]);
    expect(report.gateDecisions.level1).toMatchObject({
      status: 'blocked',
      reason: 'evidence_metrics_below_threshold',
    });
    expect(report.gateDecisions.level2.status).toBe('blocked');
    expect(report.gateDecisions.level3.status).toBe('blocked');
    expect(report.acceptanceGateSummaries.map((summary) => summary.benchmark)).toEqual([...REQUIRED_BENCHMARKS]);
  });

  it('passes Level 1 and Level 2 only when evidence thresholds pass before active/default-on rollout', () => {
    const report = buildCvkEvalReport({
      benchmarks: REQUIRED_BENCHMARKS.map((benchmark) => ({
        id: `${benchmark}-passing`,
        benchmark,
        metrics: PASSING_METRICS,
        failures: [],
      })),
      generatedArtifacts: [],
    });

    expect(report.gateDecisions.level1).toMatchObject({
      status: 'pass',
      nextAllowedAction: 'active_pilot',
    });
    expect(report.gateDecisions.level2).toMatchObject({
      status: 'pass',
      nextAllowedAction: 'default_on_candidate',
    });
    expect(report.gateDecisions.level3.status).toBe('blocked');
  });

  it('names missing required benchmarks in acceptance summaries', () => {
    const report = buildCvkEvalReport({
      benchmarks: REQUIRED_BENCHMARKS
        .filter((benchmark) => benchmark !== 'compact_recovery')
        .map((benchmark) => ({
          id: `${benchmark}-passing`,
          benchmark,
          metrics: PASSING_METRICS,
          failures: [],
        })),
      generatedArtifacts: [],
    });

    expect(report.gateDecisions.level1).toMatchObject({
      status: 'blocked',
      reason: 'benchmark_coverage_missing',
    });
    expect(report.acceptanceGateSummaries.find((summary) => summary.benchmark === 'compact_recovery')).toEqual({
      benchmark: 'compact_recovery',
      status: 'fail',
      failures: ['Required benchmark compact_recovery was not provided.'],
    });
  });

  it('lets evidence loss override high token savings and scans generated artifacts for secrets', () => {
    const secretScan = scanGeneratedArtifactSecrets([{
      path: 'artifacts/context-runtime-kit/report.json',
      content: 'OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890abcdef',
    }]);
    const report = buildCvkEvalReport({
      benchmarks: REQUIRED_BENCHMARKS.map((benchmark) => ({
        id: `${benchmark}-high-tsr-low-err`,
        benchmark,
        metrics: { ...PASSING_METRICS, TSR: 0.9, ERR: benchmark === 'compact_recovery' ? 0.5 : 1 },
        failures: benchmark === 'compact_recovery' ? ['Evidence retention dropped.'] : [],
      })),
      generatedArtifacts: [{
        path: 'artifacts/context-runtime-kit/report.json',
        content: 'OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890abcdef',
      }],
    });

    expect(secretScan).toEqual([
      expect.objectContaining({
        path: 'artifacts/context-runtime-kit/report.json',
        kind: 'openai_key',
      }),
    ]);
    expect(report.gateDecisions.level1).toMatchObject({
      status: 'blocked',
      reason: 'secret_scan_failed',
    });
    expect(report.evidencePriority).toEqual({
      tokenSavingsCannotOverrideEvidenceLoss: true,
      blockedByEvidenceLoss: true,
    });
  });
});
