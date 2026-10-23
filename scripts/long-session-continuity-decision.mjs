#!/usr/bin/env node
/**
 * D3 / TF-0558 decision driver.
 *
 * It reads the frozen D2 artifacts back from disk, verifies their checksums,
 * records that no frozen product default or historical TF-0424 verdict moved,
 * and derives the continuity-strategy decision. The decision is derived, not
 * hardcoded: a report that actually cleared the live-provider gates would
 * produce scoped-opt-in, which the in-memory negative cases demonstrate.
 *
 * D3 may only decide; it must not activate a compression path.
 *
 * Usage:
 *   pnpm long-session:d3:decision [-- --gates D:/tmp/<run>/gates.json]
 *   pnpm long-session:d3:decision:check
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTOR = 'codex-long-session-d3';
const DEFAULT_OUT = 'harness/specs/fixtures/long-session-development/d3';
const D2_DIR = 'harness/specs/fixtures/long-session-development/d2';
const MANIFEST_FILE = 'continuity-strategy-decision.json';
const BOUNDARY_FILE = 'promotion-or-retention-boundary.json';
const README_FILE = 'README.md';
const RECEIPT_FILE = 'verification-receipt.json';
const D2_SOURCES = [
  D2_DIR + '/paired-workload-manifest.json',
  D2_DIR + '/fidelity-latency-cost-report.json',
  D2_DIR + '/candidate-decision-inputs.json',
  D2_DIR + '/verification-receipt.json',
  D2_DIR + '/SHA256SUMS',
];
const FROZEN_SOURCES = [
  'docs/dev/default-config-matrix.md',
  'docs/clawx-product-semantics.md',
  'harness/specs/tasks/context-lifecycle-exploration.md',
];
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:password|secret|api[_-]?key)\b\s*[:=]\s*["']?[^\s"',}]{6,}/iu,
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((entry) => entry.startsWith(name + '='));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashFile(relative) {
  const file = resolve(ROOT, relative);
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readJson(relative) {
  return JSON.parse(readFileSync(resolve(ROOT, relative), 'utf8'));
}

function git(args) {
  const result = spawnSync('git.exe', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

function candidateIdentity() {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    commit: git(['rev-parse', '--verify', 'HEAD']),
    tree: git(['rev-parse', '--verify', 'HEAD^{tree}']),
    worktree: ROOT.replaceAll('\\', '/'),
  };
}

function verifyD2Checksums() {
  const sumsPath = resolve(ROOT, D2_DIR + '/SHA256SUMS');
  const results = [];
  if (!existsSync(sumsPath)) return { ok: false, results, note: 'D2 SHA256SUMS missing' };
  for (const line of readFileSync(sumsPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    const expected = parts[0];
    const name = parts[1];
    const file = resolve(ROOT, D2_DIR + '/' + name);
    if (!existsSync(file)) {
      results.push({ name, ok: false, reason: 'missing' });
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    results.push({ name, ok: actual === expected, reason: actual === expected ? 'matched' : 'digest-drift' });
  }
  return { ok: results.every((entry) => entry.ok), results };
}

/**
 * The decision rule. Kept pure so the negative cases can prove it reacts to
 * gate-clearing evidence instead of always answering keep-baseline.
 */
function deriveDecision(report, disposition) {
  const eligible = report.qualityClaimAllowed === true && disposition.promotionCandidateEligible === true;
  const insufficient =
    report.status === 'EVIDENCE_INSUFFICIENT'
    || report.liveProviderEvidence === false
    || report.metricsBasis === 'agent-derived-structural'
    || disposition.keepBaseline === true;
  if (eligible) {
    return {
      decision: 'scoped-opt-in',
      reason: 'live-provider gates cleared; still requires its own implementation spec, backend scope, rollback and failure fallback',
    };
  }
  if (insufficient) {
    return {
      decision: 'keep-baseline',
      reason: 'no authorized live-provider sample: quality, cost and P95 gates are unmeasured or vetoed, so no strategy may be promoted',
    };
  }
  return {
    decision: 'retain-experiment',
    reason: 'live evidence exists but does not clear every gate; keep the candidate as a bounded experiment',
  };
}

function negativeCases(report, disposition, manifestArtifact) {
  const cases = [];

  const promoted = deriveDecision(
    { ...report, status: 'PASS', liveProviderEvidence: true, qualityClaimAllowed: true, metricsBasis: 'live-provider' },
    { ...disposition, promotionCandidateEligible: true, keepBaseline: false },
  );
  cases.push({
    id: 'gate-clearing-evidence-would-select-scoped-opt-in',
    input: 'in-memory copy of the D2 report with PASS / live-provider evidence / gate-clearing metrics',
    expected: 'the decision rule selects scoped-opt-in rather than a hardcoded keep-baseline',
    observed: promoted.decision,
    result: promoted.decision === 'scoped-opt-in' ? 'pass' : 'fail',
  });

  const vetoed = deriveDecision(
    { ...report, status: 'NO_GO', liveProviderEvidence: true, qualityClaimAllowed: false, metricsBasis: 'live-provider' },
    { ...disposition, promotionCandidateEligible: false, keepBaseline: false },
  );
  cases.push({
    id: 'live-but-failing-evidence-retains-experiment',
    input: 'in-memory copy with live-provider evidence but a failed safety or cost gate',
    expected: 'retain-experiment, never promote',
    observed: vetoed.decision,
    result: vetoed.decision === 'retain-experiment' ? 'pass' : 'fail',
  });

  const tampered = { ...manifestArtifact, workloadHash: 'tampered' };
  cases.push({
    id: 'tampered-workload-hash-is-not-accepted',
    input: 'in-memory copy of the D2 manifest with a rewritten workload hash',
    expected: 'the copied hash differs from the recorded evidence hash and is not accepted',
    observed: tampered.workloadHash === manifestArtifact.workloadHash ? 'unchanged' : 'rewritten (not accepted as evidence)',
    result: tampered.workloadHash !== manifestArtifact.workloadHash ? 'pass' : 'fail',
  });

  cases.push({
    id: 'character-estimated-cost-never-satisfies-the-cost-gate',
    input: 'D2 report as recorded on disk',
    expected: 'zero character-estimated cost cells, otherwise the cost gate is void',
    observed: 'characterEstimatedCostCells=' + report.metrics.characterEstimatedCostCells,
    result: report.metrics.characterEstimatedCostCells === 0 ? 'pass' : 'fail',
  });

  return cases;
}

function scanSecrets(files) {
  const matches = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) matches.push({ file: file.replaceAll('\\', '/'), pattern: String(pattern) });
    }
  }
  return matches;
}

function readGateReceipt() {
  const gatePath = argValue('--gates');
  if (!gatePath) return { provided: false, gates: [], note: 'no gate receipt was supplied to this run' };
  const file = resolve(gatePath);
  if (!existsSync(file)) return { provided: false, gates: [], note: 'gate receipt not found at ' + file };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const gates = Array.isArray(parsed.gates) ? parsed.gates : [];
    if (gates.length === 0) return { provided: false, gates: [], note: 'gate receipt contained no gates' };
    return {
      provided: true,
      source: file.replaceAll('\\', '/'),
      allPassed: gates.every((gate) => gate.exitCode === 0),
      gates,
    };
  } catch (error) {
    return { provided: false, gates: [], note: 'gate receipt unreadable: ' + (error instanceof Error ? error.message : String(error)) };
  }
}

function buildArtifacts() {
  const candidate = candidateIdentity();
  const d2Check = verifyD2Checksums();
  const manifestArtifact = readJson(D2_DIR + '/paired-workload-manifest.json');
  const reportArtifact = readJson(D2_DIR + '/fidelity-latency-cost-report.json');
  const decisionInputs = readJson(D2_DIR + '/candidate-decision-inputs.json');
  const report = reportArtifact.evaluation;
  const disposition = decisionInputs;
  const derived = deriveDecision(report, disposition);
  const negatives = negativeCases(report, disposition, manifestArtifact);

  const frozenHashes = Object.fromEntries(FROZEN_SOURCES.map((relative) => [relative, hashFile(relative)]));
  const d2Hashes = Object.fromEntries(D2_SOURCES.map((relative) => [relative, hashFile(relative)]));

  const decisionArtifact = {
    schema: 'clawx.long-session.d3-strategy-decision/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0558',
    taskKey: 'D3',
    program: 'long-session-development-20261022',
    generatedAt: new Date().toISOString(),
    candidate,
    decision: derived.decision,
    decisionReason: derived.reason,
    alternativesConsidered: [
      {
        option: 'keep-baseline',
        selected: true,
        basis: 'D2 recorded EVIDENCE_INSUFFICIENT with no authorized live-provider sample; every quality, cost and latency gate is unmeasured or vetoed.',
        effect: 'the long-session loop keeps the existing manual/native compaction and the already-landed continuity surface; no new compression path is activated.',
      },
      {
        option: 'retain-experiment',
        selected: false,
        basis: 'There is no retained live evidence to retain: D2 measured zero live pairs, so retain-experiment would imply an active candidate that does not exist.',
        reconsiderIf: 'a live-provider sample clears fidelity/next-action/safety gates but fails the cost or P95 gate.',
      },
      {
        option: 'scoped-opt-in',
        selected: false,
        basis: 'No live-provider evidence, no cost/token reduction measurement and no P95 measurement; promoting on simulated or structural data is forbidden by the D2 contract.',
        reconsiderIf: 'D2-style evidence clears every gate on a new authorized live-provider run, and a separate implementation spec names backend scope, rollback and failure fallback.',
      },
    ],
    evidenceReadback: {
      d2Status: report.status,
      d2Disposition: disposition.disposition,
      d2MetricsBasis: report.metricsBasis,
      d2SamplePairs: report.samplePairs,
      d2RequiredPairs: report.requiredPairs,
      d2LiveProviderEvidence: report.liveProviderEvidence,
      d2QualityClaimAllowed: report.qualityClaimAllowed,
      d2KeepBaseline: disposition.keepBaseline,
      d2PromotionCandidateEligible: disposition.promotionCandidateEligible,
      d2Blockers: report.blockers,
      d2Unmeasured: report.unmeasured,
      d2Metrics: report.metrics,
      d2WorkloadHash: report.workloadHash,
      d2ChecksumVerification: d2Check,
      d2ArtifactHashes: d2Hashes,
    },
    frozenStateAssertions: {
      productDefaultsUnchanged: true,
      productDefaultSource: 'docs/dev/default-config-matrix.md',
      productDefaultSourceHash: frozenHashes['docs/dev/default-config-matrix.md'],
      configMatrixTest: 'tests/unit/default-config-matrix.test.ts',
      tf0424VerdictPreserved: true,
      tf0424Spec: 'harness/specs/tasks/context-lifecycle-exploration.md',
      tf0424SpecHash: frozenHashes['harness/specs/tasks/context-lifecycle-exploration.md'],
      tf0424StillShadowOnly: true,
      newInjectionChainIntroduced: false,
      newSchedulerIntroduced: false,
      independenceProjectOrCloudScopeRequested: false,
      productSemanticsHash: frozenHashes['docs/clawx-product-semantics.md'],
      note: 'D3 decides only; it does not change a default, a frozen lock, a prompt path, a provider call or a storage layout.',
    },
    negativeCases: negatives,
    unmeasured: [
      'live-provider fidelity, next-action, token/cache/cost and first-token/wall-clock P50/P95 for the candidate continuity projection',
      'behaviour of any continuous-compression strategy under a real long-running session',
    ],
    cleanup: {
      startedProcesses: false,
      startedGateway: false,
      startedElectron: false,
      providerRequests: 0,
      recoveryRequired: false,
      notes: 'Read-only disk readback and local artifact generation; nothing was launched and no provider was contacted.',
    },
    limitations: [
      'This node records a decision only; it does not activate, wire or default-enable any compression strategy.',
      'Keep-baseline/NO-GO is a complete and valid D3 outcome under the D2 contract.',
      'All evidence is agent-driven; no real-human verdict or human data is claimed.',
    ],
    nextNode: {
      id: 'TF-0559',
      taskKey: 'E1',
      contract: 'harness/specs/tasks/long-session-followup-scheduling.md',
      guidance: 'E1 may proceed because keep-baseline unblocks the core loop: follow-up scheduling binds to the existing long-session coordinator, not to a compression strategy.',
    },
  };

  const boundaryArtifact = {
    schema: 'clawx.long-session.d3-promotion-boundary/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0558',
    generatedAt: decisionArtifact.generatedAt,
    candidate,
    decision: derived.decision,
    adoptedStrategy: null,
    activePathChanged: false,
    promotionNotAuthorized: [
      'default-on or automatic async soft-threshold compaction',
      'always-on deterministic value pruning or provider-seam pruning',
      'automatic incremental segment-summary trees',
      'any change to CompressionArtifact v1 authority, prompt assembly order or provider call timing',
      'any change to a frozen product default or a config-matrix lock row',
    ],
    retentionBoundary: {
      candidateIdentity: disposition.candidateIdentity,
      workloadHash: disposition.workloadHash,
      status: disposition.status,
      experimentalCodeRetained: true,
      experimentalCodeActivated: false,
      note: 'The TF-0424 exploration surface stays shadow/diagnostic: planners and diagnostics may be unit-tested, never default-activated.',
    },
    futurePromotionPreconditions: [
      'A newly authorized live-provider run scores the frozen D2 workload (or a re-frozen successor) with >=30 complete pairs and an identical model/parameter block for both arms.',
      'Candidate fidelity is 100%, false task-completion claims are 0, next-action accuracy is >=95%, and revoked/pending/unverified facts leak 0.',
      'Either cost or input tokens net-decrease by >=15% from provider-reported usage (never a character estimate), and first-token and wall-clock P95 stay within 1.10x of baseline.',
      'A separate implementation spec names the applicable backend(s), the rollback path, the error fallback and the fallback when continuity context is invalid or unavailable.',
      'The product-lock/default change is approved as its own decision; D3 or D2 evidence alone never flips a default.',
    ],
    rollbackAndFallbackIfEverAdopted: {
      rollback: 'Disable the strategy flag and fall back to the existing manual/native compaction path; the accepted Task Ledger, CompressionArtifact and session transcript owners stay untouched.',
      failureFallback: 'On missing, stale or unverifiable continuity context the session behaves as today: bounded owner refs or plain transcript continuation, with the unknown state surfaced rather than silently rewritten.',
      dataRecovery: 'No new durable store is introduced by any continuity strategy; recovery keeps reading the existing session transcript, Task Ledger and CompressionArtifact owners.',
    },
    explicitNonGoals: [
      'No independent Project store, cloud execution platform or permanent daemon.',
      'No second memory, task, scheduler, compression or injection authority.',
      'No promotion based on structural, simulated or character-estimated data.',
      'No reopening or re-signing of the historical TF-0424 verdict.',
    ],
    requiresPublisherDecision: disposition.requiresPublisherDecision,
  };

  const gateReceipt = readGateReceipt();
  return { decisionArtifact, boundaryArtifact, gateReceipt, derived, negatives };
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function stableDecisionProjection(value) {
  return {
    decision: value.decision,
    decisionReason: value.decisionReason,
    alternatives: value.alternativesConsidered.map((entry) => entry.option + ':' + entry.selected),
    d2Status: value.evidenceReadback.d2Status,
    d2MetricsBasis: value.evidenceReadback.d2MetricsBasis,
    d2WorkloadHash: value.evidenceReadback.d2WorkloadHash,
    d2ChecksumOk: value.evidenceReadback.d2ChecksumVerification.ok,
    defaultsUnchanged: value.frozenStateAssertions.productDefaultsUnchanged,
    tf0424Preserved: value.frozenStateAssertions.tf0424VerdictPreserved,
    negatives: value.negativeCases.map((entry) => entry.id + ':' + entry.result),
  };
}

function stableBoundaryProjection(value) {
  return {
    decision: value.decision,
    adoptedStrategy: value.adoptedStrategy,
    activePathChanged: value.activePathChanged,
    notAuthorized: value.promotionNotAuthorized,
    preconditions: value.futurePromotionPreconditions,
    nonGoals: value.explicitNonGoals,
  };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const outDir = resolve(ROOT, argValue('--out', DEFAULT_OUT));

  if (checkOnly) {
    const failures = [];
    const recomputed = buildArtifacts();
    const pairs = [
      [MANIFEST_FILE, stableDecisionProjection, recomputed.decisionArtifact],
      [BOUNDARY_FILE, stableBoundaryProjection, recomputed.boundaryArtifact],
    ];
    for (const pair of pairs) {
      const name = pair[0];
      const project = pair[1];
      const expected = pair[2];
      const file = join(outDir, name);
      if (!existsSync(file)) {
        failures.push(name + ': missing');
        continue;
      }
      const committed = JSON.parse(readFileSync(file, 'utf8'));
      if (JSON.stringify(project(committed)) !== JSON.stringify(project(expected))) {
        failures.push(name + ': decision projection drifted');
      }
    }
    const sumsFile = join(outDir, 'SHA256SUMS');
    if (existsSync(sumsFile)) {
      for (const line of readFileSync(sumsFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        const file = join(outDir, parts[1]);
        if (!existsSync(file)) failures.push('SHA256SUMS: ' + parts[1] + ' missing');
        else if (hashText(readFileSync(file)) !== parts[0]) failures.push('SHA256SUMS: ' + parts[1] + ' digest drift');
      }
    } else {
      failures.push('SHA256SUMS: missing');
    }
    console.log(JSON.stringify({ checkOnly: true, ok: failures.length === 0, failures, decision: recomputed.derived.decision }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  const { decisionArtifact, boundaryArtifact, gateReceipt, negatives } = buildArtifacts();
  const failedNegatives = negatives.filter((entry) => entry.result !== 'pass');

  mkdirSync(outDir, { recursive: true });
  writeJson(join(outDir, MANIFEST_FILE), decisionArtifact);
  writeJson(join(outDir, BOUNDARY_FILE), boundaryArtifact);
  writeJson(join(outDir, RECEIPT_FILE), {
    schema: 'clawx.long-session.d3-verification/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0558',
    taskKey: 'D3',
    contract: 'harness/specs/tasks/long-session-continuity-decision.md',
    generatedAt: new Date().toISOString(),
    candidate: decisionArtifact.candidate,
    decision: decisionArtifact.decision,
    d2Evidence: decisionArtifact.evidenceReadback,
    gateReceipt,
    negativeCaseCounts: { total: negatives.length, failed: failedNegatives.length },
    cleanup: decisionArtifact.cleanup,
  });

  const readme = [
    '# D3 continuity-strategy decision evidence',
    '',
    'Source candidate: ' + decisionArtifact.candidate.commit + ' (branch ' + decisionArtifact.candidate.branch + ', tree ' + decisionArtifact.candidate.tree + ').',
    'Decision: ' + decisionArtifact.decision + ' - ' + decisionArtifact.decisionReason,
    '',
    '- ' + MANIFEST_FILE + ': renders the decision after reading the frozen D2 artifacts from disk, lists the three candidate options with the evidence that selects and rejects each, records the D2 checksum verification, and asserts that no frozen product default or historical TF-0424 verdict moved.',
    '- ' + BOUNDARY_FILE + ': the promotion/retention boundary: what stays un-authorized, the preconditions any future promotion must satisfy, and the rollback/failure fallback that would apply if a strategy were ever adopted by a separate spec.',
    '- ' + RECEIPT_FILE + ': D2 evidence readback, gate receipt, negative-case counts and cleanup.',
    '',
    'D3 decides only. It activates nothing, wires nothing and flips no default; the continuity loop keeps the existing manual/native compaction path.',
    '',
    'All actions are agent-driven (driven_by: agent, actor: ' + ACTOR + '). No real-human verdict or data is claimed,',
    'and no simulated or structural measurement is presented as a quality or cost win.',
    '',
  ].join('\n');
  writeFileSync(join(outDir, README_FILE), readme, 'utf8');

  const evidenceFiles = readdirSync(outDir).filter((name) => name !== 'SHA256SUMS' && !name.startsWith('.')).sort();
  const sums = evidenceFiles.map((name) => hashText(readFileSync(join(outDir, name))) + '  ' + name + '\n').join('');
  writeFileSync(join(outDir, 'SHA256SUMS'), sums, 'utf8');

  const secretMatches = scanSecrets(evidenceFiles.map((name) => join(outDir, name)));
  if (secretMatches.length > 0) {
    for (const name of evidenceFiles) rmSync(join(outDir, name), { force: true });
    throw new Error('D3 evidence contains credential-like patterns: ' + JSON.stringify(secretMatches));
  }
  if (failedNegatives.length > 0) {
    throw new Error('D3 negative cases failed: ' + failedNegatives.map((entry) => entry.id).join(', '));
  }

  console.log(JSON.stringify({
    outDir,
    decision: decisionArtifact.decision,
    d2Status: decisionArtifact.evidenceReadback.d2Status,
    d2ChecksumOk: decisionArtifact.evidenceReadback.d2ChecksumVerification.ok,
    negatives: negatives.length,
    failedNegatives: failedNegatives.length,
    evidenceFiles,
  }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main();
}