#!/usr/bin/env node
// Independent WP6 verifier: rebuild the closeout from child evidence, compare the
// normalized report, re-anchor the manifest and replay both final SHA256SUMS files.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  MC6_DECISION_PATH,
  MC6_EVIDENCE_ROOT,
  MC6_EVIDENCE_SHA_PATHS,
  MC6_SHA_PATH,
  MC6_SHA_PATHS,
  WP6_EVIDENCE_ROOT,
  WP6_EVIDENCE_SHA_PATHS,
  WP6_MANIFEST_PATH,
  WP6_MANIFEST_SCHEMA,
  WP6_REPORT_PATH,
  WP6_SHA_PATH,
  WP6_SHA_PATHS,
  buildWp6Closeout,
  documentDigest,
  sha256,
  validateMc6Decision,
  validateWp6Report,
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

export function verifyWp6Closeout({
  artifact = existingOrFallback(resolve(root, WP6_REPORT_PATH), resolve(root, WP6_EVIDENCE_ROOT, 'final-report.json')),
  manifestPath = existingOrFallback(resolve(root, WP6_MANIFEST_PATH), resolve(root, WP6_EVIDENCE_ROOT, 'manifest.json')),
  mc6Path = existingOrFallback(resolve(root, MC6_DECISION_PATH), resolve(root, MC6_EVIDENCE_ROOT, 'decision.json')),
} = {}) {
  const stored = readJson(artifact, 'WP6 final report');
  const manifest = readJson(manifestPath, 'WP6 manifest');
  const storedMc6 = readJson(mc6Path, 'MC6 decision');
  const live = buildWp6Closeout({ root });
  const issues = [];
  issues.push(...validateWp6Report(stored).issues.map((issue) => `report: ${issue}`));
  issues.push(...validateMc6Decision(storedMc6).issues.map((issue) => `mc6: ${issue}`));
  issues.push(...validateMc6Decision(live.mc6Decision).issues.map((issue) => `live-mc6: ${issue}`));
  if (stored.digest !== live.report.digest) issues.push('stored report digest differs from the live closeout replay');
  if (storedMc6.digest !== live.mc6Decision.digest) issues.push('stored MC6 digest differs from the live decision replay');
  if (stored.evidenceManifests?.entryCount !== live.report.evidenceManifests.entryCount) issues.push('pre-closeout evidence entry count drifted');
  if (stored.evidenceManifests?.uniqueFileCount !== live.report.evidenceManifests.uniqueFileCount) issues.push('pre-closeout unique file count drifted');

  if (manifest.schema !== WP6_MANIFEST_SCHEMA) issues.push('manifest schema mismatch');
  if (manifest.task !== 'TF-0472') issues.push('manifest task mismatch');
  if (manifest.passed !== true) issues.push('manifest is not passed');
  if (manifest.finalReport?.path !== WP6_REPORT_PATH) issues.push('manifest final-report path mismatch');
  if (manifest.finalReport?.curatedPath !== `${WP6_EVIDENCE_ROOT}/final-report.json`) issues.push('manifest curated report path mismatch');
  if (manifest.finalReport?.sha256 !== hashFile(artifact)) issues.push('manifest does not anchor the final report bytes');
  if (manifest.finalReport?.digest !== stored.digest) issues.push('manifest final-report digest mismatch');
  if (manifest.mc6Decision?.path !== MC6_DECISION_PATH) issues.push('manifest MC6 path mismatch');
  if (manifest.mc6Decision?.curatedPath !== `${MC6_EVIDENCE_ROOT}/decision.json`) issues.push('manifest curated MC6 path mismatch');
  if (stored.mc6?.curatedPath !== `${MC6_EVIDENCE_ROOT}/decision.json`) issues.push('report curated MC6 path mismatch');
  if (manifest.mc6Decision?.sha256 !== hashFile(mc6Path)) issues.push('manifest does not anchor the MC6 decision bytes');
  if (manifest.mc6Decision?.digest !== storedMc6.digest) issues.push('manifest MC6 digest mismatch');
  if (manifest.mc6Decision?.decision !== 'sidecar-only' || manifest.mc6Decision?.sourceExtractionTriggered !== false) issues.push('manifest MC6 disposition drifted');
  if (manifest.requiredGates?.length !== 12) issues.push('manifest required-gate count mismatch');
  if (manifest.evidenceManifests?.length !== 12) issues.push('manifest tracked evidence-manifest count mismatch');
  if (manifest.evidenceUniqueFileCount !== stored.evidenceManifests?.uniqueFileCount) issues.push('manifest unique evidence file count mismatch');
  if (manifest.credentialScan?.passed !== true || manifest.credentialScan?.hits?.length !== 0) issues.push('manifest credential scan is missing or failed');
  if (manifest.localMirrorManifests?.declared !== 12 || manifest.localMirrorManifests?.requiredForCleanReplay !== false) issues.push('manifest local mirror policy mismatch');
  if (manifest.release?.releaseEligible !== false || manifest.release?.ga !== false || manifest.release?.defaultOn !== false) issues.push('manifest promoted release posture');
  if (manifest.authority?.hostVerdict !== 'unchanged' || manifest.authority?.m4Authorized !== false) issues.push('manifest authority drifted');
  if (manifest.digest !== documentDigest(manifest)) issues.push('manifest digest is not reproducible');

  const evidenceReport = resolve(root, WP6_EVIDENCE_ROOT, 'final-report.json');
  const evidenceManifest = resolve(root, WP6_EVIDENCE_ROOT, 'manifest.json');
  const evidenceMc6 = resolve(root, MC6_EVIDENCE_ROOT, 'decision.json');
  for (const [left, right, label] of [
    [artifact, evidenceReport, 'final report'],
    [manifestPath, evidenceManifest, 'manifest'],
    [mc6Path, evidenceMc6, 'MC6 decision'],
  ]) {
    if (!existsSync(right)) issues.push(`curated ${label} missing`);
    else if (left !== right && hashFile(left) !== hashFile(right)) issues.push(`curated ${label} differs from artifact`);
  }

  const evidenceSums = verifyShaManifest({ root, path: resolve(root, WP6_EVIDENCE_ROOT, 'SHA256SUMS'), expectedPaths: WP6_EVIDENCE_SHA_PATHS });
  issues.push(...evidenceSums.issues.map((issue) => `wp6-evidence-sums: ${issue}`));
  if (existsSync(resolve(root, WP6_REPORT_PATH))) {
    const artifactSums = verifyShaManifest({ root, path: resolve(root, WP6_SHA_PATH), expectedPaths: WP6_SHA_PATHS });
    issues.push(...artifactSums.issues.map((issue) => `wp6-artifact-sums: ${issue}`));
  }
  const mc6EvidenceSums = verifyShaManifest({ root, path: resolve(root, MC6_EVIDENCE_ROOT, 'SHA256SUMS'), expectedPaths: MC6_EVIDENCE_SHA_PATHS });
  issues.push(...mc6EvidenceSums.issues.map((issue) => `mc6-evidence-sums: ${issue}`));
  if (existsSync(resolve(root, MC6_DECISION_PATH))) {
    const mc6ArtifactSums = verifyShaManifest({ root, path: resolve(root, MC6_SHA_PATH), expectedPaths: MC6_SHA_PATHS });
    issues.push(...mc6ArtifactSums.issues.map((issue) => `mc6-artifact-sums: ${issue}`));
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    report: stored,
    mc6: storedMc6,
    manifest,
  };
}

function main() {
  const result = verifyWp6Closeout({
    artifact: at('--artifact') ?? undefined,
    manifestPath: at('--manifest') ?? undefined,
    mc6Path: at('--mc6') ?? undefined,
  });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-wp6-verify] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-wp6-verify] OK gates=${result.report.gateSummary.verified}/${result.report.gateSummary.required} manifests=${result.report.evidenceManifests.count} entries=${result.report.evidenceManifests.entryCount} decision=${result.mc6.decision} release_eligible=${result.report.release.releaseEligible}`);
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[versegit-wp6-verify] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  }
}
