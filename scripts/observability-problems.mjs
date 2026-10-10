#!/usr/bin/env node
// Agent-driven cross-run Problem aggregation over the sanitized trace index.
// Usage:
//   node --import tsx scripts/observability-problems.mjs --index <trace-index.jsonl> --out <dir>
// Optional:
//   --window-days 7
//   --now 2026-10-10T00:00:00.000Z
//   --state <problemId|signature>=<pending|open|mitigated|closed>
import fs from 'node:fs/promises';
import path from 'node:path';
import { exportObservabilityProblemArtifacts } from '../electron/services/observability-problems.ts';

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function readStateOverrides() {
  const overrides = {};
  for (const arg of process.argv) {
    if (!arg.startsWith('--state=')) continue;
    const value = arg.slice('--state='.length);
    const separator = value.lastIndexOf('=');
    if (separator <= 0) continue;
    const key = value.slice(0, separator);
    const state = value.slice(separator + 1);
    if (['pending', 'open', 'mitigated', 'closed'].includes(state)) {
      overrides[key] = { state };
    }
  }
  return overrides;
}

async function main() {
  const indexDir = process.env.VERSE_CLAW_OBSERVABILITY_INDEX_DIR?.trim()
    || path.join(process.env.VERSE_CLAW_DATA_DIR?.trim() || process.cwd(), 'observability');
  const indexPath = path.resolve(readArg('index', path.join(indexDir, 'trace-index.jsonl')));
  const outputDir = path.resolve(readArg('out', path.join(process.cwd(), 'artifacts', 'observability-problems')));
  const windowDays = Number(readArg('window-days', '7'));
  const nowArg = readArg('now');
  const now = nowArg ? Date.parse(nowArg) : undefined;
  if (!Number.isFinite(windowDays) || windowDays < 0) {
    throw new Error('--window-days must be a non-negative number');
  }
  if (nowArg && !Number.isFinite(now)) {
    throw new Error('--now must be an ISO timestamp');
  }

  const raw = await fs.readFile(indexPath, 'utf8');
  const entries = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const entry = record?.entry ?? record;
      if (entry && typeof entry.id === 'string') entries.push(entry);
    } catch {
      // Corrupt index rows are ignored; the owning index compacts them later.
    }
  }

  const result = await exportObservabilityProblemArtifacts({
    entries,
    outputDir,
    ...(now !== undefined ? { now } : {}),
    windowMs: windowDays * 24 * 60 * 60 * 1000,
    actor: 'codex-observability-problems',
    stateOverrides: readStateOverrides(),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});