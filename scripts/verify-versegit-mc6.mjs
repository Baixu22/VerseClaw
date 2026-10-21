#!/usr/bin/env node
// MC6 verifier: replay the sidecar-only decision from MC4/MC5/WP2/WP5 evidence and
// check the decision artifacts and both retained checksum manifests.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  MC6_DECISION_PATH,
  MC6_EVIDENCE_ROOT,
  MC6_EVIDENCE_SHA_PATHS,
  MC6_FIXTURE_PATH,
  MC6_SHA_PATH,
  MC6_SHA_PATHS,
  buildMc6Decision,
  sha256,
  validateMc6Decision,
  verifyShaManifest,
} from './versegit-wp6-closeout.mjs';

const root = process.env.VERSEGIT_WP6_ROOT ? resolve(process.env.VERSEGIT_WP6_ROOT) : resolve(process.cwd());

function at(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? resolve(process.argv[index + 1]) : undefined;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} missing: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hashFile(path) {
  return sha256(readFileSync(path));
}

function existingOrFallback(preferred, fallback) {
  return existsSync(preferred) ? preferred : fallback;
}

export function verifyMc6Decision({ artifact = existingOrFallback(resolve(root, MC6_DECISION_PATH), resolve(root, MC6_EVIDENCE_ROOT, 'decision.json')) } = {}) {
  const stored = readJson(artifact, 'MC6 decision');
  const fixture = readJson(resolve(root, MC6_FIXTURE_PATH), 'MC6 fixture');
  const live = buildMc6Decision({ root }).decision;
  const issues = [];
  issues.push(...validateMc6Decision(stored).issues);
  issues.push(...validateMc6Decision(live).issues.map((issue) => `live: ${issue}`));
  if (stored.digest !== live.digest) issues.push('stored decision differs from the live evidence replay');
  if (stored.fixtureDigest !== hashFile(resolve(root, MC6_FIXTURE_PATH))) issues.push('fixture digest mismatch');
  if (fixture.decision !== 'sidecar-only' || fixture.sourceExtractionTriggered !== false) issues.push('fixture triggered source extraction');

  const evidence = Object.fromEntries(fixture.requiredEvidence.map((path) => [path, readJson(resolve(root, path), path)]));
  const mc1 = evidence['harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json'];
  const mc4 = evidence['harness/specs/fixtures/versegit-planning-correction/mc4-evidence/adapter-report.json'];
  const mc5 = evidence['harness/specs/fixtures/versegit-planning-correction/mc5-evidence/differential-report.json'];
  const wp0 = evidence['harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json'];
  const wp2 = evidence['harness/specs/fixtures/versegit-planning-correction/wp2-evidence/report.json'];
  const wp5 = evidence['harness/specs/fixtures/versegit-planning-correction/wp5-evidence/soak-report.json'];
  if (mc4.status !== 'equivalent') issues.push('MC4 adapter equivalence is not stable');
  if (mc5.status !== 'framework_verified') issues.push('MC5 differential gate is not stable');
  const publicContractStable = mc1.schema === 'clawx.versegit.consumer-contract/v1'
    && mc1.import_policy?.deep_import_allowed === false
    && wp0.status === 'verified'
    && wp0.host_verdict === 'unchanged'
    && wp0.gate?.passed === true
    && wp0.version_matrix?.consumer_contract_version === mc1.schema
    && wp0.version_matrix?.module_report_schema === mc1.surface?.module_report?.schema
    && wp0.version_matrix?.command_plan_schema === mc1.surface?.command_plan?.schema;
  if (!publicContractStable) issues.push('MC1/WP0 public consumer contract is not stable');
  if (wp5.passed !== true || wp5.summary?.processCalls !== 0) issues.push('WP5 replay is not sidecar-safe');
  const multi = (wp2.cases ?? []).find((entry) => entry.caseId === 'multi-worktree');
  if (!(multi?.probes ?? []).some((entry) => entry.id === 'provider.conflicts-plan' && entry.status === 'unavailable')) issues.push('WP2 conflicts-plan availability changed');

  const evidenceDecision = resolve(root, MC6_EVIDENCE_ROOT, 'decision.json');
  if (!existsSync(evidenceDecision)) issues.push('curated MC6 decision missing');
  else if (artifact !== evidenceDecision && hashFile(artifact) !== hashFile(evidenceDecision)) issues.push('curated MC6 decision differs from artifact');

  const evidenceSums = verifyShaManifest({ root, path: resolve(root, MC6_EVIDENCE_ROOT, 'SHA256SUMS'), expectedPaths: MC6_EVIDENCE_SHA_PATHS });
  issues.push(...evidenceSums.issues.map((issue) => `evidence-sums: ${issue}`));
  if (existsSync(resolve(root, MC6_DECISION_PATH))) {
    const artifactSums = verifyShaManifest({ root, path: resolve(root, MC6_SHA_PATH), expectedPaths: MC6_SHA_PATHS });
    issues.push(...artifactSums.issues.map((issue) => `artifact-sums: ${issue}`));
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)], decision: stored };
}

function main() {
  const result = verifyMc6Decision({ artifact: at('--artifact') ?? undefined });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-mc6] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-mc6] OK decision=${result.decision.decision} extraction=${result.decision.sourceExtractionTriggered} digest=${result.decision.digest.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[versegit-mc6] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  }
}
