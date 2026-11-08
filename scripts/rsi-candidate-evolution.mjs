#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildEvolutionExport, checkEvolutionExport } from './lib/rsi-candidate-evolution.mjs';

/** Read the existing SQLite owner without migrations, writes or source-side counters. */
export function exportEvolutionDatabase({ dbPath, runId }) {
  assert(typeof dbPath === 'string' && typeof runId === 'string', 'evolution-db-and-run-id-required');
  const database = new DatabaseSync(resolve(dbPath), { readOnly: true });
  try {
    const rows = database.prepare("SELECT trajectory_id, metadata_json FROM sekb_trajectories WHERE task_type = 'rsi/candidate-evolution' AND json_extract(metadata_json, '$.rsiEvolutionEntry.runId') = ?").all(runId);
    const entries = rows.map(row => {
      const entry = JSON.parse(row.metadata_json).rsiEvolutionEntry;
      assert(row.trajectory_id === `rsi-evolution:${entry.runId}:${entry.kind}:${entry.generation}`, 'evolution-sqlite-identity-drift');
      return entry;
    });
    return buildEvolutionExport(entries);
  } finally { database.close(); }
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      db: { type: 'string' }, 'run-id': { type: 'string' }, input: { type: 'string' }, out: { type: 'string' },
    } });
    assert(positionals.length === 1 && ['export', 'check'].includes(positionals[0]),
      'Usage: node scripts/rsi-candidate-evolution.mjs <export --db PATH --run-id ID --out NEW.json | check --input PATH>');
    let exported;
    if (positionals[0] === 'export') {
      exported = exportEvolutionDatabase({ dbPath: values.db, runId: values['run-id'] });
      assert(values.out, '--out required');
      writeFileSync(resolve(values.out), JSON.stringify(exported, null, 2) + '\n', { flag: 'wx' });
    } else {
      assert(values.input, '--input required');
      exported = JSON.parse(readFileSync(resolve(values.input), 'utf8'));
    }
    const checked = checkEvolutionExport(exported);
    console.log(JSON.stringify({ ...checked, runId: exported.runId, budget: exported.budget,
      verdicts: exported.decisions?.map(decision => decision.status) }, null, 2));
    if (!checked.passed) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
