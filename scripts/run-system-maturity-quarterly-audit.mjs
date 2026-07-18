#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runSystemMaturityQuarterlyAudit,
  validateQuarterlyAuditReport,
} from './lib/system-maturity-quarterly-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const outArgIndex = process.argv.indexOf('--out');
const defaultOut = path.join(root, 'artifacts/system-maturity/P7-004');
const outDir = path.resolve(outArgIndex >= 0 ? process.argv[outArgIndex + 1] : defaultOut);

fs.mkdirSync(outDir, { recursive: true });
const report = runSystemMaturityQuarterlyAudit({ root });
const validationErrors = validateQuarterlyAuditReport(report);
const reportPath = path.join(outDir, dryRun ? 'quarterly-audit-dry-run.json' : 'quarterly-audit-report.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const relativeReport = path.relative(root, reportPath).replace(/\\/gu, '/');
console.log(`quarterly audit: ok=${report.ok} dryRun=${dryRun} score=${report.scorecard.total} grade=${report.scorecard.grade} release=${report.releaseDecision.code}`);
console.log(`report: ${relativeReport}`);
if (report.agentDevAudit) {
  console.log(`agent-dev: status=${report.agentDevAudit.status} releaseReady=${report.agentDevAudit.releaseReady} score=${report.agentDevAudit.score} (not whole-system)`);
}
if (validationErrors.length) {
  for (const error of validationErrors) console.error(`FAIL  ${error}`);
}
if (!report.ok || validationErrors.length) {
  for (const reason of report.fail || []) console.error(`FAIL  ${reason}`);
  process.exit(1);
}
console.log('validate-system-maturity-quarterly-audit: OK');
