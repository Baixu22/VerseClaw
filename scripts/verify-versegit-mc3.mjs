#!/usr/bin/env node
// MC3 delivery verifier: re-derives the sidecar package identity from the frozen MC0
// baseline and the live binary, then proves the stored manifest agrees and that a digest
// mismatch is rejected by policy instead of falling back to another binary.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  buildMc3Package, validateMc3Package, verifyPackageIdentity, MC0_BASELINE_PATH,
} from './versegit-mc3-delivery.mjs';

function fileSha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main() {
  const argv = process.argv;
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? resolve(argv[i + 1]) : undefined; };
  const artifact = at('--artifact') ?? resolve(process.cwd(), 'harness/specs/fixtures/versegit-planning-correction/mc3-evidence/package-manifest.json');
  const requireDeliverable = argv.includes('--require-deliverable');
  if (!existsSync(artifact)) {
    console.error(`[versegit-mc3] FAIL: artifact missing: ${artifact}`);
    process.exitCode = 1;
    return;
  }
  const frozen = JSON.parse(readFileSync(artifact, 'utf8'));
  const issues = [];
  issues.push(...validateMc3Package(frozen, { requireDeliverable }).issues);

  const mc0 = JSON.parse(readFileSync(resolve(process.cwd(), MC0_BASELINE_PATH), 'utf8'));
  const binary = at('--binary') ?? resolve(String(mc0.binary.path));
  if (!existsSync(binary)) {
    console.error(`[versegit-mc3] FAIL: frozen sidecar binary is missing: ${binary}`);
    process.exitCode = 1;
    return;
  }
  const liveSha = fileSha(binary);
  const gate = verifyPackageIdentity({
    identity: frozen.identity,
    expectedBinarySha: liveSha,
    expectedSourceCommit: mc0.source.head,
  });
  if (gate.status !== 'verified') issues.push(`frozen package identity does not match the live binary/source: ${gate.mismatches.join(',')}`);
  const liveBytes = readFileSync(binary).length;
  if (frozen.identity?.binary_bytes !== liveBytes) issues.push('live binary byte length differs from the frozen package');
  const live = buildMc3Package({ repo: mc0.source.repo, binary }).manifest;
  issues.push(...validateMc3Package(live).issues.map((issue) => `live: ${issue}`));
  if (live.identity.binary_sha256 !== frozen.identity.binary_sha256) issues.push('live binary digest differs from the frozen package');
  if (live.identity.effective_source_commit !== frozen.identity.effective_source_commit) issues.push('live effective source commit differs from the frozen package');
  if (live.identity.capabilities_digest !== frozen.identity.capabilities_digest) issues.push('live capabilities digest differs from the frozen package');
  if (live.identity.contract_digest !== frozen.identity.contract_digest) issues.push('live consumer contract digest differs from the frozen package');
  if (live.identity.golden_bundle_digest !== frozen.identity.golden_bundle_digest) issues.push('live golden bundle digest differs from the frozen package');
  const frozenSmoke = Object.fromEntries((frozen.startup_smoke ?? []).map((entry) => [entry.id, entry.status]));
  for (const [id, status] of Object.entries(frozenSmoke)) {
    if (live.startup_smoke.some((entry) => entry.id === id && entry.status === status) === false) {
      issues.push(`startup smoke ${id} no longer reports ${status}`);
    }
  }
  if (live.cleanup?.cleanup_status !== 'clean') issues.push(`live cleanup did not converge: ${live.cleanup?.cleanup_status}`);
  if (frozen.installation?.no_system_drive_artifacts !== true) issues.push('frozen install root is on the system drive');
  if (frozen.boundaries?.vg_source_tree_copied !== false) issues.push('VG source tree must not be copied into ClawX');
  if (!requireDeliverable && frozen.deliverable !== 'rejected') issues.push('a dirty or unreleased provider source must keep the package rejected');
  if (issues.length > 0) {
    for (const issue of issues) console.error(`[versegit-mc3] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-mc3] OK status=${frozen.status} deliverable=${frozen.deliverable} binary=${frozen.identity.binary_sha256.slice(0, 12)} smoke=${Object.keys(frozenSmoke).length}`);
}

if (isMainEntrypoint(import.meta.url)) main();
