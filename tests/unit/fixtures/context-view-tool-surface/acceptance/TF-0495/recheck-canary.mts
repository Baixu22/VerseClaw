import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = 'tests/unit/fixtures/context-view-tool-surface/acceptance/TF-0495';
const protocolBytes = fs.readFileSync(path.join(outputDir, 'canary-protocol.json'));
const protocol = JSON.parse(protocolBytes.toString('utf8')) as {
  design: { totalCalls: number; arms: { A_discovery: { sampleSize: number }; B_unavailable: { sampleSize: number } } };
};
const run = JSON.parse(fs.readFileSync(path.join(outputDir, 'canary-run-v1.json'), 'utf8')) as {
  schemaVersion: string;
  protocolSha256: string;
  decision: { status: string };
  summary: {
    totalCalls: number; providerErrors: number; parseFailures: number;
    A_toolDiscoveryPassCount: number; A_toolDiscoverySuccessRate: number;
    B_correctUnavailableCount: number; falseToolPresenceClaims: number; unauthorizedViewToolCalls: number;
  };
};
const recomputedProtocolHash = createHash('sha256').update(protocolBytes).digest('hex');
const aSize = protocol.design.arms.A_discovery.sampleSize;
const bSize = protocol.design.arms.B_unavailable.sampleSize;
const checks: Record<string, boolean> = {
  protocolHashMatchesRun: run.protocolSha256 === recomputedProtocolHash,
  sampleSize: run.summary.totalCalls === protocol.design.totalCalls,
  armASample: run.summary.A_toolDiscoveryPassCount <= aSize,
  armBSample: run.summary.B_correctUnavailableCount <= bSize,
  toolDiscoverySuccess: run.summary.A_toolDiscoverySuccessRate >= 0.95,
  falseToolPresenceClaims: run.summary.falseToolPresenceClaims === 0,
  unauthorizedViewToolCalls: run.summary.unauthorizedViewToolCalls === 0,
  providerErrorRate: run.summary.providerErrors / Math.max(1, protocol.design.totalCalls) < 0.05,
  parseFailureRate: run.summary.parseFailures / Math.max(1, protocol.design.totalCalls) <= 0.1,
  decisionPass: run.decision.status === 'pass',
};
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({
  ok,
  checks,
  recomputedProtocolHash,
  summary: run.summary,
  decision: run.decision,
  schemaVersion: run.schemaVersion,
}, null, 2));
if (!ok) process.exitCode = 1;
