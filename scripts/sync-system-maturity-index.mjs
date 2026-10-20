#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAN_ROOT_REL,
  readPhaseTopology,
  renderIndexTable,
  renderStructureTable,
} from './lib/system-maturity-phases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planRoot = path.join(root, PLAN_ROOT_REL);
const indexPath = path.join(planRoot, 'INDEX.md');
const topology = readPhaseTopology(root);
const phaseDirs = topology.phases.map((phase) => phase.id);

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
const headerIndex = lines.findIndex((line) => line.startsWith('| Phase |'));
let next;
if (headerIndex >= 0) {
  const table = renderIndexTable(topology, statusByPhase);
  let end = headerIndex;
  while (end < lines.length && lines[end].startsWith('|')) end += 1;
  next = [...lines.slice(0, headerIndex), ...table, ...lines.slice(end)];
} else {
  const suffix = lines.join('\n').replace(/\n*$/u, '');
  next = `${suffix}\n\n${renderIndexTable(topology, statusByPhase).join('\n')}`.split(/\r?\n/);
}

const out = `${next.join('\n').replace(/\n*$/u, '')}\n`;
fs.writeFileSync(indexPath, out);

const structurePath = path.join(planRoot, 'STRUCTURE.md');
if (fs.existsSync(structurePath)) {
  const structure = fs.readFileSync(structurePath, 'utf8').replaceAll('\r\n', '\n');
  const begin = '<!-- BEGIN GENERATED PHASE TABLE -->';
  const end = '<!-- END GENERATED PHASE TABLE -->';
  const start = structure.indexOf(begin);
  const stop = structure.indexOf(end);
  if (start >= 0 && stop > start) {
    const table = `${begin}\n${renderStructureTable(topology, statusByPhase).join('\n')}\n${end}`;
    const nextStructure = structure.slice(0, start) + table + structure.slice(stop + end.length);
    fs.writeFileSync(structurePath, nextStructure);
  }
}

console.log('sync-system-maturity-index: OK');
for (const [phase, status] of Object.entries(statusByPhase)) {
  console.log(`  ${phase}=${status}`);
}

