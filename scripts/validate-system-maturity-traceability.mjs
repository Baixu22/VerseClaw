#!/usr/bin/env node
import fs from 'node:fs';
import { acceptanceArtifactPath } from './lib/acceptance-artifacts.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSystemMaturityTraceability } from './lib/system-maturity-traceability.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let evaluatedAt = process.env.SYSTEM_MATURITY_EVALUATED_AT;
if (!evaluatedAt) {
  try {
    evaluatedAt = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    evaluatedAt = new Date().toISOString();
  }
}

const report = validateSystemMaturityTraceability({
  root,
  now: new Date(evaluatedAt),
  evaluatedAt,
});
const outDir = acceptanceArtifactPath(root, 'system-maturity/P7-001');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'traceability-report.json'), `${JSON.stringify(report, null, 2)}\n`);

for (const message of report.warn) console.warn(`WARN  ${message}`);
for (const message of report.fail) console.error(`FAIL  ${message}`);
console.log(`traceability: findings=${report.summary.findingCount} tasks=${report.summary.taskCount} tests=${report.summary.testCount} fresh=${report.summary.freshCount} stale=${report.summary.staleCount}`);

if (!report.ok) {
  console.error(`validate-system-maturity-traceability: FAILED (${report.fail.length})`);
  process.exit(1);
}
console.log('validate-system-maturity-traceability: OK');
