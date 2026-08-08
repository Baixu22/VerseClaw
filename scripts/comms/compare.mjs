import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { candidateIdentity, validateReplayArtifact } from './replay.mjs';

export const COMMS_COMPARE_SCHEMA = 'comms-compare-report/v1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const HARD_THRESHOLDS = {
  duplicate_event_rate: 0.005,
  event_fanout_ratio: 1.2,
  history_inflight_max: 1,
  rpc_timeout_rate: 0.01,
  message_loss_count: 0,
  message_order_violation_count: 0,
};

const RELATIVE_THRESHOLDS = {
  history_load_qps: 0.10,
  rpc_p95_ms: 0.15,
};

const REQUIRED_SCENARIOS = [
  'gateway-restart-during-run',
  'happy-path-chat',
  'history-overlap-guard',
  'invalid-config-patch-recovered',
  'multi-agent-channel-switch',
  'network-degraded',
];

function ratioDelta(current, baseline) {
  if (!Number.isFinite(baseline) || baseline === 0) return current === 0 ? 0 : Infinity;
  return (current - baseline) / baseline;
}

function fmtPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function fmtNumber(value) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : String(value);
}

export function evaluateReport(current, baseline) {
  const c = current.aggregate ?? {};
  const b = baseline.aggregate ?? {};
  const scenarios = current.scenarios ?? {};
  const failures = [];
  const rows = [];

  for (const scenario of REQUIRED_SCENARIOS) {
    if (!scenarios[scenario]) {
      failures.push(`missing scenario: ${scenario}`);
      rows.push(`| scenario:${scenario} | missing | required | FAIL |`);
      continue;
    }
    const scenarioMetrics = scenarios[scenario];
    for (const [metric, threshold] of Object.entries(HARD_THRESHOLDS)) {
      const cv = Number(scenarioMetrics[metric] ?? 0);
      const pass = cv <= threshold;
      if (!pass) failures.push(`scenario:${scenario} ${metric}=${cv} > ${threshold}`);
      rows.push(`| ${scenario}.${metric} | ${fmtNumber(cv)} | <= ${threshold} | ${pass ? 'PASS' : 'FAIL'} |`);
    }
  }

  for (const [metric, threshold] of Object.entries(HARD_THRESHOLDS)) {
    const cv = Number(c[metric] ?? 0);
    const pass = cv <= threshold;
    if (!pass) failures.push(`${metric}=${cv} > ${threshold}`);
    rows.push(`| ${metric} | ${fmtNumber(cv)} | <= ${threshold} | ${pass ? 'PASS' : 'FAIL'} |`);
  }

  for (const [metric, maxIncrease] of Object.entries(RELATIVE_THRESHOLDS)) {
    const cv = Number(c[metric] ?? 0);
    const bv = Number(b[metric] ?? 0);
    const delta = ratioDelta(cv, bv);
    const pass = delta <= maxIncrease;
    if (!pass) failures.push(`${metric} delta=${delta} > ${maxIncrease}`);
    rows.push(`| ${metric} | ${fmtNumber(cv)} (baseline ${fmtNumber(bv)}) | delta <= ${fmtPercent(maxIncrease)} | ${pass ? 'PASS' : 'FAIL'} (${fmtPercent(delta)}) |`);
  }

  return { failures, rows };
}

export function validateCompareArtifact(value, options = {}) {
  const errors = [];
  if (!value || typeof value !== 'object') return ['compare artifact must be an object'];
  if (value.schema !== COMMS_COMPARE_SCHEMA) errors.push('compare artifact schema mismatch');
  if (!/^[a-f0-9]{40}$/u.test(String(value.candidate?.commit ?? '')) || !/^[a-f0-9]{40}$/u.test(String(value.candidate?.tree ?? ''))) {
    errors.push('compare artifact candidate identity is malformed');
  }
  if (options.candidate && (
    value.candidate?.commit !== options.candidate.commit || value.candidate?.tree !== options.candidate.tree
  )) {
    errors.push('compare artifact candidate identity mismatch');
  }
  if (!['PASS', 'FAIL'].includes(value.result)) errors.push('compare artifact result is invalid');
  if (!Array.isArray(value.failures) || !Array.isArray(value.rows)) errors.push('compare artifact failures/rows are missing');
  return errors;
}

export async function main(options = {}) {
  const root = path.resolve(options.root ?? ROOT);
  const outputDir = path.resolve(options.outputDir ?? process.env.COMMS_OUTPUT_DIR ?? path.join(root, 'artifacts/comms'));
  const currentFile = path.join(outputDir, 'current-metrics.json');
  const baselineFile = path.resolve(options.baselineFile ?? path.join(root, 'scripts/comms/baseline/metrics.baseline.json'));
  const reportFile = path.join(outputDir, 'compare-report.md');
  const reportJsonFile = path.join(outputDir, 'compare-report.json');
  const current = JSON.parse(await readFile(currentFile, 'utf8'));
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  const candidate = candidateIdentity(root);
  const currentErrors = validateReplayArtifact(current, { candidate });
  if (currentErrors.length > 0) throw new Error(`current replay artifact invalid: ${currentErrors.join('; ')}`);
  const { failures, rows } = evaluateReport(current, baseline);
  const result = failures.length === 0 ? 'PASS' : 'FAIL';

  const report = [
    '# Comms Regression Report',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Candidate: ${candidate.commit} (${candidate.tree})`,
    `- Result: ${result}`,
    '',
    '| Metric | Current | Threshold | Status |',
    '|---|---:|---:|---|',
    ...rows,
    '',
  ].join('\n');

  const machineReport = {
    schema: COMMS_COMPARE_SCHEMA,
    generated_at: new Date().toISOString(),
    candidate,
    replay_candidate: current.candidate,
    result,
    failures,
    rows,
  };
  const validationErrors = validateCompareArtifact(machineReport, { candidate });
  if (validationErrors.length > 0) throw new Error(validationErrors.join('; '));
  await mkdir(outputDir, { recursive: true });
  await writeFile(reportFile, report);
  await writeFile(reportJsonFile, JSON.stringify(machineReport, null, 2));
  const persisted = JSON.parse(await readFile(reportJsonFile, 'utf8'));
  const persistedErrors = validateCompareArtifact(persisted, { candidate });
  if (persistedErrors.length > 0) throw new Error(`persisted compare artifact invalid: ${persistedErrors.join('; ')}`);
  console.log(report);
  console.log(`\nWrote comparison report to ${reportFile}`);

  if (failures.length > 0) {
    console.error('\nThreshold failures:\n- ' + failures.join('\n- '));
    process.exitCode = 1;
  }
  return machineReport;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((error) => {
    console.error('[comms:compare] failed:', error);
    process.exitCode = 1;
  });
}
