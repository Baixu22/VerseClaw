#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  collectMc2Fingerprint, resolveMc2Binary, validateMc2Fingerprint, sha256, MC0_BASELINE_PATH,
} from './versegit-mc2-fingerprint.mjs';

const repositoryRoot = resolve(process.cwd());

function digestOfFingerprint(fingerprint) {
  return sha256(JSON.stringify({ ...fingerprint, generated_at: undefined, digest: undefined }));
}

function caseDigests(cases) {
  return Object.fromEntries((cases ?? []).map((entry) => [entry.id, entry.output_digest]));
}

function main() {
  const artifactIndex = process.argv.indexOf('--artifact');
  const artifact = artifactIndex >= 0
    ? resolve(process.argv[artifactIndex + 1])
    : resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/mc2-evidence/golden.json');
  const requireDeliverable = process.argv.includes('--require-deliverable');
  if (!existsSync(artifact)) {
    console.error(`[versegit-mc2] FAIL: artifact missing: ${artifact}`);
    process.exitCode = 1;
    return;
  }
  const frozen = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateMc2Fingerprint(frozen).issues);
  const mc0 = JSON.parse(readFileSync(resolve(repositoryRoot, MC0_BASELINE_PATH), 'utf8'));
  const binary = resolveMc2Binary(mc0);
  const live = collectMc2Fingerprint({ binary, mc0 });
  issues.push(...validateMc2Fingerprint(live).issues.map((issue) => `live: ${issue}`));
  if (live.identity.binary_sha256 !== frozen.identity.binary_sha256) issues.push('live binary digest differs from the frozen fingerprint');
  if (live.identity.mc0_source_head !== frozen.identity.mc0_source_head) issues.push('live MC0 source head differs from the frozen fingerprint');
  if (live.identity.capabilities_schema !== frozen.identity.capabilities_schema) issues.push('live capabilities schema differs from the frozen fingerprint');
  const frozenCases = caseDigests(frozen.cases);
  const liveCases = caseDigests(live.cases);
  if (Object.keys(frozenCases).length !== Object.keys(liveCases).length) {
    issues.push(`case count differs: frozen=${Object.keys(frozenCases).length} live=${Object.keys(liveCases).length}`);
  }
  for (const [id, digest] of Object.entries(frozenCases)) {
    if (liveCases[id] === undefined) { issues.push(`case ${id} is missing from the live run`); continue; }
    if (liveCases[id] !== digest) issues.push(`case ${id} output digest drifted from the frozen fingerprint`);
  }
  if (live.cleanup.cleanup_status !== 'clean') issues.push(`live cleanup did not converge: ${live.cleanup.cleanup_status}`);
  if (frozen.cleanup?.cleanup_status !== 'clean') issues.push('frozen cleanup must be clean');
  if (digestOfFingerprint(frozen) !== frozen.digest) issues.push('frozen digest mismatch');
  if (requireDeliverable && frozen.boundaries?.deliverable !== 'eligible') issues.push('deliverable fingerprint required');
  if (!requireDeliverable && frozen.boundaries?.deliverable !== 'rejected') issues.push('diagnostic fingerprint must explicitly reject a dirty source baseline');
  if (issues.length > 0) {
    for (const issue of issues) console.error(`[versegit-mc2] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-mc2] OK cases=${frozen.cases.length} head=${frozen.identity.mc0_source_head} binary=${frozen.identity.binary_sha256.slice(0, 12)} digest=${frozen.digest.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) main();
