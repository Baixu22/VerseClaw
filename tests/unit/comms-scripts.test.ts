// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  aggregateMetrics,
  candidateIdentity,
  calculateScenarioMetrics,
  validateReplayArtifact,
} from '../../scripts/comms/replay.mjs';
import { evaluateReport, validateCompareArtifact } from '../../scripts/comms/compare.mjs';

const temporaryPaths: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, '..', '..');

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function buildPassingScenarioMetrics() {
  return {
    duplicate_event_rate: 0,
    event_fanout_ratio: 1,
    history_inflight_max: 1,
    history_load_qps: 0.3,
    rpc_p50_ms: 100,
    rpc_p95_ms: 150,
    rpc_timeout_rate: 0,
    gateway_reconnect_count: 0,
    message_loss_count: 0,
    message_order_violation_count: 0,
  };
}

describe('comms scripts', () => {
  it('computes scenario metrics with dedupe and inflight tracking', () => {
    const metrics = calculateScenarioMetrics([
      { ts: 0, type: 'gateway_event', runId: 'r1', sessionKey: 's1', seq: 1, state: 'started', fanout: 1 },
      { ts: 0.2, type: 'gateway_event', runId: 'r1', sessionKey: 's1', seq: 1, state: 'started', fanout: 1 },
      { ts: 0.5, type: 'history_load', sessionKey: 's1', action: 'start' },
      { ts: 0.7, type: 'history_load', sessionKey: 's1', action: 'end' },
      { ts: 1.0, type: 'rpc', latencyMs: 120, timeout: false },
      { ts: 1.5, type: 'message', lost: false, orderViolation: false },
    ]);

    expect(metrics.duplicate_event_rate).toBeCloseTo(0.5, 6);
    expect(metrics.history_inflight_max).toBe(1);
    expect(metrics.rpc_p95_ms).toBe(120);
  });

  it('aggregates multiple scenario metrics deterministically', () => {
    const aggregate = aggregateMetrics([
      { ...buildPassingScenarioMetrics(), rpc_p95_ms: 200 },
      { ...buildPassingScenarioMetrics(), rpc_p95_ms: 400 },
    ]);
    expect(aggregate.rpc_p95_ms).toBe(300);
    expect(aggregate.history_inflight_max).toBe(1);
  });

  it('fails report evaluation when required scenarios are missing', () => {
    const passing = buildPassingScenarioMetrics();
    const current = {
      aggregate: passing,
      scenarios: {
        'happy-path-chat': passing,
      },
    };
    const baseline = { aggregate: passing };
    const result = evaluateReport(current, baseline);

    expect(result.failures.some((f: string) => f.includes('missing scenario'))).toBe(true);
  });

  it('runs literal Node entrypoints and regenerates candidate-bound artifacts', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'comms-script-output-'));
    temporaryPaths.push(outputDir);
    const env = { ...process.env, COMMS_OUTPUT_DIR: outputDir };
    const replayPath = join(repositoryRoot, 'scripts', 'comms', 'replay.mjs');
    const comparePath = join(repositoryRoot, 'scripts', 'comms', 'compare.mjs');
    const metricsPath = join(outputDir, 'current-metrics.json');
    const reportPath = join(outputDir, 'compare-report.json');

    execFileSync(process.execPath, [replayPath], { cwd: repositoryRoot, env, stdio: 'pipe' });
    expect(existsSync(metricsPath)).toBe(true);
    expect(statSync(metricsPath).size).toBeGreaterThan(0);
    const firstMetrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
    expect(validateReplayArtifact(firstMetrics, { candidate: candidateIdentity(repositoryRoot) })).toEqual([]);

    unlinkSync(metricsPath);
    execFileSync(process.execPath, [replayPath], { cwd: repositoryRoot, env, stdio: 'pipe' });
    const regeneratedMetrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
    expect(validateReplayArtifact(regeneratedMetrics, { candidate: candidateIdentity(repositoryRoot) })).toEqual([]);

    execFileSync(process.execPath, [comparePath], { cwd: repositoryRoot, env, stdio: 'pipe' });
    expect(existsSync(reportPath)).toBe(true);
    expect(statSync(reportPath).size).toBeGreaterThan(0);
    const firstReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(validateCompareArtifact(firstReport, { candidate: candidateIdentity(repositoryRoot) })).toEqual([]);

    unlinkSync(reportPath);
    execFileSync(process.execPath, [comparePath], { cwd: repositoryRoot, env, stdio: 'pipe' });
    const regeneratedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(validateCompareArtifact(regeneratedReport, { candidate: candidateIdentity(repositoryRoot) })).toEqual([]);
  });
});
