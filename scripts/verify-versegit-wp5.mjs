#!/usr/bin/env node
// WP5 verifier: rerun the bounded disposable-worktree replay/soak and compare normalized
// outcomes, cleanup and failure-preservation facts without relying on wall-clock values.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildWp5Report, validateWp5Report, WP5_FIXTURE_PATH, WP5_SCHEMA } from './versegit-wp5-soak.mjs';
import { sha256 } from './versegit-mc5-differential.mjs';
const root = process.env.VERSEGIT_WP5_ROOT ? resolve(process.env.VERSEGIT_WP5_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }
async function main() {
  const artifact = at('--artifact') ?? resolve(root, 'artifacts/versegit/wp5/soak-report.json');
  if (!existsSync(artifact)) { console.error(`[versegit-wp5] FAIL: artifact missing ${artifact}`); process.exitCode = 1; return; }
  const stored = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateWp5Report(stored).issues.map((issue) => `stored: ${issue}`));
  const live = await buildWp5Report({ root, fixturePath: resolve(root, WP5_FIXTURE_PATH) });
  issues.push(...validateWp5Report(live.report).issues.map((issue) => `live: ${issue}`));
  if (stored.normalizedOutcomeDigest !== live.report.normalizedOutcomeDigest) issues.push('normalized soak outcomes drifted');
  if (stored.summary?.cycles !== 3 || stored.summary?.processCalls !== 0 || stored.summary?.failedScenarios !== 0) issues.push('soak summary drifted');
  if (stored.schema !== WP5_SCHEMA) issues.push('WP5 schema mismatch');
  if (!stored.cycles?.every((entry) => entry.cleanup?.worktreesDeleted === 2 && entry.cleanup?.survivors === 0 && entry.cleanup?.tempRootRemoved === true)) issues.push('stored worktree cleanup failed');
  const failureIds = new Set((stored.failures ?? []).map((entry) => entry.id));
  for (const id of ['single_worktree', 'verseshell_unavailable', 'sidecar_crash', 'report_tamper']) if (!failureIds.has(id)) issues.push(`missing failure scenario ${id}`);
  if (stored.boundaries?.sidecarProcessesStarted !== false || stored.boundaries?.hostWorktreesDeleted !== false || stored.boundaries?.tempSurvivors !== 0) issues.push('stored resource boundary failed');
  if (stored.hostVerdict !== 'unchanged') issues.push('stored host verdict changed');
  if (stored.digest !== sha256(JSON.stringify({ ...stored, generated_at: undefined, digest: undefined }))) issues.push('stored digest is not reproducible');
  if (issues.length > 0) { for (const issue of issues) console.error(`[versegit-wp5] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log(`[versegit-wp5] OK cycles=${stored.summary.cycles} scenarios=${stored.summary.scenarios} process_calls=0 normalized=${stored.normalizedOutcomeDigest.slice(0, 12)}`);
}
if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(`[versegit-wp5] FAIL: ${String(error?.stack ?? error)}`); process.exitCode = 1; });