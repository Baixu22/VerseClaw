#!/usr/bin/env node
// Agent-driven issue #143 cutover evidence gate. The evaluator reports
// eligibility and stage; it never changes frozen product defaults.
import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateMemoryCutoverGate } from '../openclaw_runtime/src/memory/memory-dual-gate.ts';

const evidenceFlag = process.argv.indexOf('--evidence');
const evidenceArg = evidenceFlag >= 0 ? process.argv[evidenceFlag + 1] : process.argv[2];
if (!evidenceArg) {
  throw new Error('usage: pnpm memory:cutover-gate -- --evidence <evidence.json>');
}
const evidencePath = path.resolve(evidenceArg);
const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
const decision = evaluateMemoryCutoverGate(evidence);
process.stdout.write(`${JSON.stringify({ evidence: evidencePath, decision }, null, 2)}\n`);