#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runSecuritySuite,
  validateSecuritySuiteReport,
} from './lib/system-maturity-security-suite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') || 'pr';
const manifestPath = path.resolve(root, readArg('--manifest') || 'plans/system-maturity/security-regression-suite.json');
const defaultOut = process.env.SYSTEM_MATURITY_SECURITY_OUT
  || (process.env.CI
    ? path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'clawx-system-maturity', 'P7-002')
    : path.join(root, 'artifacts/system-maturity/P7-002'));
const outDir = path.resolve(readArg('--out') || defaultOut);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const report = runSecuritySuite({ root, manifest, mode, outDir });
const validationErrors = validateSecuritySuiteReport({ root, outDir, report });
fs.writeFileSync(
  path.join(outDir, 'evidence-manifest.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    task: 'P7-002',
    mode,
    report: path.relative(root, path.join(outDir, 'security-regression-report.json')).replace(/\\/gu, '/'),
    ok: validationErrors.length === 0,
    validationErrors,
  }, null, 2)}\n`,
);

console.log(`security regression: mode=${mode} scenarios=${report.scenarioIds.length} commands=${report.commands.length} failed=${report.failedCommandIds.length}`);
if (validationErrors.length) {
  for (const error of validationErrors) console.error(`FAIL  ${error}`);
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
