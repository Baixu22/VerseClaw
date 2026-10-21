#!/usr/bin/env node
// WP3 verifier: replay the structural receipt matrix and independently prove that
// only host-authored receipt bindings can be consumed, while no live execution is claimed.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildWp3Evidence, validateWp3Report, WP3_FIXTURE_PATH, WP3_SCHEMA } from './versegit-wp3-receipts.mjs';
import { sha256 } from './versegit-mc5-differential.mjs';

const root = process.env.VERSEGIT_WP3_ROOT ? resolve(process.env.VERSEGIT_WP3_ROOT) : resolve(process.cwd());
function at(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; }
async function main() {
  const artifact = at('--artifact') ?? resolve(root, 'artifacts/versegit/wp3/verdict.json');
  if (!existsSync(artifact)) { console.error(`[versegit-wp3] FAIL: artifact missing ${artifact}`); process.exitCode = 1; return; }
  const stored = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateWp3Report(stored).issues.map((issue) => `stored: ${issue}`));
  const live = await buildWp3Evidence({ root, fixturePath: resolve(root, WP3_FIXTURE_PATH) });
  issues.push(...validateWp3Report(live.report).issues.map((issue) => `live: ${issue}`));
  if (stored.digest !== live.report.digest) issues.push('stored digest differs from the live receipt replay');
  if (stored.status !== undefined || stored.schema !== WP3_SCHEMA) issues.push('WP3 schema mismatch');
  const byId = new Map((stored.cases ?? []).map((entry) => [entry.caseId, entry]));
  const valid = byId.get('valid_structural_receipt');
  if (valid?.receiptResult?.status !== 'accepted' || valid?.verdict?.dimensions?.execution !== 'unmeasured') issues.push('valid structural receipt must be accepted but never promoted to live execution');
  for (const [id, expected] of Object.entries({
    wrong_candidate: 'rejected_by_policy', stale_epoch: 'rejected_by_policy', plan_digest_mismatch: 'rejected_by_policy',
    argv_digest_mismatch: 'rejected_by_policy', missing_artifact: 'rejected_by_policy', selected_scope_claimed_full: 'rejected_by_policy',
    caller_self_report: 'rejected_by_policy', missing_receipt: 'rejected_by_policy', duplicate_receipt: 'duplicate',
  })) {
    if (byId.get(id)?.receiptResult?.status !== expected) issues.push(`${id} did not reject as ${expected}`);
  }
  const source = readFileSync(resolve(root, 'electron/services/versegit-receipt-bridge.ts'), 'utf8');
  for (const forbidden of ['child_process', 'execFileSync', 'spawnSync', 'exec(']) if (source.includes(forbidden)) issues.push(`receipt bridge contains forbidden execution surface: ${forbidden}`);
  if (!source.includes('clawx-host-process-artifact-authority') || !source.includes("requiredScope !== 'full'")) issues.push('receipt bridge authority/scope checks are missing');
  const serialized = readFileSync(artifact, 'utf8');
  for (const marker of ['D:\\Projects\\VerseGit', 'C:\\Users', 'D:/Projects/VerseGit']) if (serialized.includes(marker)) issues.push(`absolute path leaked into WP3 artifact: ${marker}`);
  const expectedDigest = sha256(JSON.stringify({ ...stored, generated_at: undefined, digest: undefined }));
  if (stored.digest !== expectedDigest) issues.push('stored WP3 digest is not reproducible');
  if (stored.hostVerdict !== 'unchanged' || stored.boundaries?.hostVerdictChanged !== false) issues.push('WP3 changed the host verdict boundary');
  if (stored.realVerseshellExecutionClaimed !== false || stored.structuralOnly !== true) issues.push('WP3 must not claim live VerseShell execution');
  if (issues.length > 0) { for (const issue of issues) console.error(`[versegit-wp3] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log(`[versegit-wp3] OK cases=${stored.cases.length} accepted=${stored.summary.accepted} rejected=${stored.summary.rejected} duplicate=${stored.summary.duplicate} digest=${stored.digest.slice(0, 12)}`);
}
if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(`[versegit-wp3] FAIL: ${String(error?.stack ?? error)}`); process.exitCode = 1; });