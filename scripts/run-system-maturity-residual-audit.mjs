#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSystemMaturityResidualAudit } from './lib/system-maturity-residual.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const report = runSystemMaturityResidualAudit({ root });

const outDir = path.join(root, 'artifacts/system-maturity/P8-001');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, dryRun ? 'residual-audit-dry-run.json' : 'residual-audit-report.json');

function stablePayload(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { generatedAt, ...rest } = doc;
  return rest;
}

let toWrite = report;
if (fs.existsSync(outPath)) {
  try {
    const previous = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (JSON.stringify(stablePayload(previous)) === JSON.stringify(stablePayload(report))) {
      // Keep prior generatedAt so delivery evidence hashes remain stable across re-runs.
      toWrite = { ...report, generatedAt: previous.generatedAt || report.generatedAt };
      if (JSON.stringify(previous) === JSON.stringify(toWrite)) {
        // Bit-identical; skip rewrite.
        console.log(
          `residual audit: ok=${report.ok} active=${report.summary.residualActive} missing=${report.summary.residualMissing} expired=${report.summary.residualExpired}`,
        );
        console.log(`report: ${path.relative(root, outPath).replace(/\\/g, '/')} (unchanged)`);
        if (!report.ok) {
          for (const err of report.fail) console.error(`FAIL ${err}`);
          process.exit(1);
        }
        console.log('validate-system-maturity-residual: OK');
        process.exit(0);
      }
    }
  } catch {
    // Fall through to rewrite.
  }
}

fs.writeFileSync(outPath, `${JSON.stringify(toWrite, null, 2)}\n`);

console.log(
  `residual audit: ok=${report.ok} active=${report.summary.residualActive} missing=${report.summary.residualMissing} expired=${report.summary.residualExpired}`,
);
console.log(`report: ${path.relative(root, outPath).replace(/\\/g, '/')}`);
if (!report.ok) {
  for (const err of report.fail) console.error(`FAIL ${err}`);
  process.exit(1);
}
console.log('validate-system-maturity-residual: OK');
