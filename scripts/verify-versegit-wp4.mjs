#!/usr/bin/env node
// WP4 verifier: rebuild coverage from WP1's normalized event stream and independently
// check explicit gaps, feedback-delivery tiers, boundedness and redaction.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildWp4Evidence, validateWp4Report, WP4_FIXTURE_PATH } from './versegit-wp4-coverage.mjs';
import { sha256 } from './versegit-mc5-differential.mjs';
const root = process.env.VERSEGIT_WP4_ROOT ? resolve(process.env.VERSEGIT_WP4_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }
function main() {
  const artifact = at('--artifact') ?? resolve(root, 'artifacts/versegit/wp4/coverage.json');
  if (!existsSync(artifact)) { console.error(`[versegit-wp4] FAIL: artifact missing ${artifact}`); process.exitCode = 1; return; }
  const stored = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateWp4Report(stored).issues.map((issue) => `stored: ${issue}`));
  const live = buildWp4Evidence({ root, fixturePath: resolve(root, WP4_FIXTURE_PATH) });
  issues.push(...validateWp4Report(live.report).issues.map((issue) => `live: ${issue}`));
  if (stored.digest !== live.report.digest) issues.push('stored digest differs from the live coverage replay');
  const vector = stored.coverage?.coverageVector ?? {};
  if (vector.directFs !== 'unobserved' || vector.shellRead !== 'unobserved' || vector.shellWrite !== 'inferred') issues.push('coverage vector lost unobserved/inferred semantics');
  if (stored.coverage?.eventCount !== 12 || stored.coverage?.uniqueEventCount !== 12) issues.push('event accounting drifted');
  if (stored.coverage?.duplicateCount !== 0 || stored.coverage?.unobservedCount !== 1 || stored.sourceStatusCounts?.duplicate !== 1) issues.push('duplicate/unobserved accounting drifted');
  const source = readFileSync(resolve(root, 'electron/services/versegit-behavior-coverage.ts'), 'utf8');
  for (const forbidden of ['child_process', 'execFileSync', 'spawnSync', 'exec(']) if (source.includes(forbidden)) issues.push(`coverage module contains execution surface: ${forbidden}`);
  const serialized = readFileSync(artifact, 'utf8');
  if (/(?:^|[^A-Za-z])[A-Za-z]:[\\/]|\/Users\/|api[_-]?key|secret\s*[:=]/iu.test(serialized)) issues.push('coverage artifact contains an absolute path or secret-like field');
  if (stored.digest !== sha256(JSON.stringify({ ...stored, generated_at: undefined, digest: undefined }))) issues.push('coverage digest is not reproducible');
  if (issues.length > 0) { for (const issue of issues) console.error(`[versegit-wp4] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log(`[versegit-wp4] OK events=${stored.coverage.uniqueEventCount} duplicate=${stored.coverage.duplicateCount} unobserved=${stored.coverage.unobservedCount} digest=${stored.digest.slice(0, 12)}`);
}
if (isMainEntrypoint(import.meta.url)) main();