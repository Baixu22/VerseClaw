#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCapabilityInventoryAudit } from './lib/system-maturity-capability-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = runCapabilityInventoryAudit({ root });
const outDir = path.join(root, 'artifacts/system-maturity/P8-003');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'capability-inventory-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(`capability inventory: ok=${report.ok} caps=${report.result.rows.length}`);
console.log(`report: ${path.relative(root, outPath).replace(/\\/g, '/')}`);
if (!report.ok) {
  for (const err of report.fail) console.error(`FAIL ${err}`);
  process.exit(1);
}
console.log('validate-system-maturity-capability-inventory: OK');
