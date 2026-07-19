#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planRoot = path.join(root, 'plans/system-maturity');
const indexPath = path.join(planRoot, 'INDEX.md');

const phaseDirs = [
  'phase0-foundation',
  'phase1-direct-boundaries',
  'phase2-authorization-isolation',
  'phase3-data-authority',
  'phase4-runtime-surfaces',
  'phase5-reliability-abuse',
  'phase6-supply-release',
  'phase7-continuous-governance',
  'phase8-residual-closure',
];

const statusByPhase = {};
for (const dir of phaseDirs) {
  const statusPath = path.join(planRoot, dir, 'STATUS.json');
  if (!fs.existsSync(statusPath)) {
    statusByPhase[dir] = 'planned';
    continue;
  }
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  statusByPhase[dir] = status.phaseStatus || 'planned';
}

const source = fs.readFileSync(indexPath, 'utf8');
const lines = source.split(/\r?\n/);
const next = lines.map((line) => {
  if (!line.startsWith('| phase')) return line;
  // | phaseX-... | ... | status |
  const cells = line.split('|').map((c) => c.trim());
  // cells[0]='' cells[1]=phase ... last non-empty is status
  if (cells.length < 6) return line;
  const phaseId = cells[1];
  if (!statusByPhase[phaseId]) return line;
  cells[cells.length - 2] = statusByPhase[phaseId];
  return `| ${cells.slice(1, -1).join(' | ')} |`;
});

const out = `${next.join('\n').replace(/\n*$/u, '')}\n`;
fs.writeFileSync(indexPath, out);
console.log('sync-system-maturity-index: OK');
for (const [phase, status] of Object.entries(statusByPhase)) {
  console.log(`  ${phase}=${status}`);
}

