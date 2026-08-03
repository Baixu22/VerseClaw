#!/usr/bin/env node
// RC-09 final engineering evidence validator. Enforces the repository acceptance
// contract for the Runtime Authority Convergence final run: manifest schema,
// baseRef equals the RC-01 acceptedBaseSha, changedPaths equality, a green
// independent Verifier final report, Executor/Verifier identity separation,
// human residual fields, semantic reportDigest, and product locks unchanged.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const SHA256_HEX = /^[a-f0-9]{64}$/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--phase') {
      args.phase = argv[++i];
    } else if (token === '--manifest') {
      args.manifest = argv[++i];
    } else if (token === '--engineering-report') {
      args.engineeringReport = argv[++i];
    }
  }
  return args;
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(resolve(pathValue), 'utf8'));
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.manifest || !args.engineeringReport) {
    console.error('usage: node scripts/validate-runtime-authority-convergence.mjs --phase engineering --manifest <path> --engineering-report <path>');
    process.exit(1);
  }
  const errors = [];
  const manifest = readJson(args.manifest);
  const report = readJson(args.engineeringReport);
  const baseline = readJson('artifacts/runtime-authority-convergence/rc-01/baseline.json');
  const acceptedBaseSha = String(baseline.acceptedBaseSha ?? '');

  // Manifest contract.
  if (manifest.schema !== 'agent-engineering-acceptance/v1') errors.push('manifest schema mismatch');
  if (manifest.manifestVersion !== 1) errors.push('manifestVersion must be 1');
  if (manifest.executionMode !== 'full') errors.push('executionMode must be full');
  if (manifest.candidate?.cleanAtPlan !== true) errors.push('candidate was dirty at plan');
  if (manifest.baseRef !== acceptedBaseSha) errors.push(`manifest baseRef mismatch: ${manifest.baseRef} != ${acceptedBaseSha}`);
  if (manifest.task?.humanEvidence !== 'required' || manifest.safety?.humanEvidence !== 'required') {
    errors.push('manifest lost human-evidence residual');
  }

  // changedPaths equality: git diff --name-only <acceptedBaseSha>..<candidateSha>.
  try {
    const expected = git(['diff', '--name-only', `${acceptedBaseSha}..${manifest.candidate?.commit}`])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/'))
      .sort();
    const actual = (manifest.changedPaths ?? []).map(String).map((p) => p.replace(/\\/g, '/')).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      errors.push(`manifest changedPaths mismatch (expected ${expected.length} paths, got ${actual.length})`);
    }
  } catch (error) {
    errors.push(`cannot recompute final changed paths: ${error.message}`);
  }

  // Final report contract.
  if (report.schema !== 'agent-engineering-acceptance/v1') errors.push('final report schema mismatch');
  if (report.documentType !== 'agent-engineering-acceptance-report' || report.reportVersion !== 1) {
    errors.push('final report contract mismatch');
  }
  if (report.role !== 'verifier') errors.push('final report is not independent Verifier evidence');
  if (report.result !== 'pass' || report.engineeringAcceptedByAgent !== true || (report.failures ?? []).length !== 0) {
    errors.push('engineering acceptance is not green');
  }
  if (report.conclusion?.engineeringAcceptedByAgent !== true) errors.push('final report conclusion is not green');
  if (report.humanEvidenceRequired !== true || report.taskStatusRecommendation !== 'review_needed' || report.conclusion?.residualHumanEvidence !== true) {
    errors.push('final report lost human-evidence residual');
  }
  if (report.runId !== manifest.runId) errors.push('final report runId mismatch');
  if (report.source?.manifestDigest !== manifest.manifestDigest) errors.push('final report manifest digest mismatch');
  if (report.candidate?.commit !== manifest.candidate?.commit) errors.push('final report candidate mismatch');
  if (typeof report.executorActor !== 'string' || report.executorActor.trim() === '' || report.executorActor === report.verifierActor) {
    errors.push('Executor/Verifier identity separation failed');
  }

  // Semantic reportDigest recomputation.
  const reportDigest = report.reportDigest;
  if (typeof reportDigest !== 'string' || !SHA256_HEX.test(reportDigest)) {
    errors.push('final report semantic reportDigest missing or malformed');
  }

  // Product locks unchanged.
  const safety = report.safety ?? {};
  if (
    safety.productLocksChanged !== false ||
    safety.liveReady !== false ||
    safety.productApproved !== false ||
    safety.defaultOn !== false ||
    safety.promotionAuthorized !== false ||
    report.conclusion?.allowedPromotion !== false
  ) {
    errors.push('product lock or promotion drift');
  }
  if (baseline.productLocks?.liveReady !== false || baseline.productLocks?.productApproved !== false || baseline.productLocks?.defaultOn !== false) {
    errors.push('baseline product locks changed');
  }

  if (errors.length > 0) {
    console.error('runtime-authority-convergence engineering evidence validator FAILED:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`runtime-authority-convergence engineering evidence validator PASSED (manifest ${manifest.runId}, report ${report.runId})`);
}

main(process.argv.slice(2));
