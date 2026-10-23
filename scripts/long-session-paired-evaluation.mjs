#!/usr/bin/env node
/**
 * D2 / TF-0557 evidence driver.
 *
 * It regenerates the frozen 30-pair workload, runs the agent-derived structural
 * pass, records whether an authorized live-provider endpoint is configured, and
 * writes the curated D2 artifacts. It never simulates provider quality: with no
 * live-provider sample the report must stay EVIDENCE_INSUFFICIENT / NO-GO.
 *
 * Usage:
 *   pnpm long-session:d2:evidence -- --out harness/specs/fixtures/long-session-development/d2
 *   pnpm long-session:d2:evidence:check  (re-verify committed artifacts, writes nothing)
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  PAIRED_CANDIDATE_IDENTITY,
  PAIRED_FREEZE_EPOCH,
  PAIRED_TARGET_COUNT,
  PAIRED_WORKLOAD_FAMILIES,
  PAIRED_WORKLOAD_SCHEMA,
  assertFrozenWorkload,
  buildLongSessionPairedWorkload,
  deriveLongSessionPairedStructuralRows,
  evaluateLongSessionPair,
  renderLongSessionPairedBaselineInput,
  renderLongSessionPairedCandidateInput,
  summarizeLongSessionPairedEvaluation,
} from '../shared/long-session-paired-evaluation.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = 'harness/specs/fixtures/long-session-development/d2';
const ACTOR = 'codex-long-session-d2';
const MANIFEST_FILE = 'paired-workload-manifest.json';
const REPORT_FILE = 'fidelity-latency-cost-report.json';
const DECISION_FILE = 'candidate-decision-inputs.json';
const RECEIPT_FILE = 'verification-receipt.json';
const README_FILE = 'README.md';
const PROVIDER_ENV = ['COMPACTION_API_KEY', 'COMPACTION_BASE_URL', 'COMPACTION_PROVIDER', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:password|secret|api[_-]?key)\b\s*[:=]\s*["']?[^\s"',}]{6,}/iu,
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
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

function providerAvailability() {
  const configured = PROVIDER_ENV.filter((name) => (process.env[name] ?? '').trim().length > 0);
  return {
    probedEnvNames: PROVIDER_ENV,
    configured,
    liveProviderAuthorized: configured.includes('COMPACTION_API_KEY') || configured.includes('OPENAI_API_KEY') || configured.includes('ANTHROPIC_API_KEY'),
    note: 'Env presence is only probed; no credential value is read, hashed or persisted by this driver.',
  };
}

/** Structural exclusion evidence: the frozen projection never carries a forbidden fact. */
function structuralNegativeCases(manifest) {
  const cases = [];
  for (const entry of manifest.cases) {
    const rendered = [
      entry.candidateArtifact.objective,
      ...entry.candidateArtifact.constraints.map((item) => item.text),
      ...entry.candidateArtifact.decisions.map((item) => item.text),
      ...entry.candidateArtifact.failedAttempts.map((item) => item.text),
      ...entry.candidateArtifact.blocked.map((item) => item.text),
      entry.candidateArtifact.nextAction,
      ...(entry.candidateArtifact.semanticAtoms ?? [])
        .filter((atomValue) => atomValue.status === 'verified')
        .map((atomValue) => atomValue.text),
    ].join('\n');
    for (const forbidden of entry.forbiddenFacts) {
      const leaked = rendered.includes(forbidden.text);
      cases.push({
        id: `structural-exclusion:${entry.id}:${forbidden.reason}`,
        input: `frozen case ${entry.id} carries a ${forbidden.reason} fact`,
        expected: 'the accepted projection never contains it',
        observed: leaked ? 'leaked' : 'excluded',
        result: leaked ? 'fail' : 'pass',
      });
    }
  }
  return cases;
}

/**
 * Rows shaped like a live-provider run. They exist only to prove the promotion
 * gates reject bad candidates; they are never written as a measurement.
 */
function liveProviderShapedRows(manifest, options = {}) {
  return manifest.cases.map((caseValue) => {
    const parts = [renderLongSessionPairedCandidateInput(caseValue.candidateArtifact)];
    if (options.injectForbidden) parts.push(caseValue.forbiddenFacts[0].text);
    if (options.falseCompletion) parts.push(caseValue.forbiddenCompletionClaims[1]);
    return evaluateLongSessionPair({
      caseValue,
      baseline: {
        provider: 'gate-probe',
        model: 'frozen-paired-evaluation-model',
        measurementBasis: 'live-provider',
        outputText: renderLongSessionPairedBaselineInput(caseValue),
        costSource: options.costSource ?? 'provider-report',
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0.01,
        firstTokenMs: 400,
        wallClockMs: 1200,
      },
      candidate: {
        provider: 'gate-probe',
        model: 'frozen-paired-evaluation-model',
        measurementBasis: 'live-provider',
        outputText: parts.join('\n'),
        costSource: options.costSource ?? 'provider-report',
        inputTokens: 800,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0.008,
        firstTokenMs: 400,
        wallClockMs: 1200,
      },
    });
  });
}

/** Negatives that re-run the real scorer, so "blocked" is an observed outcome. */
function detectionNegativeCases(manifest, structuralReport) {
  const cases = [
    {
      id: 'agent-derived-cannot-promote',
      input: 'score all 30 frozen pairs from the agent-derived projection with no provider usage or timing',
      expected: 'EVIDENCE_INSUFFICIENT, keepBaseline true, promotionCandidateEligible false',
      observed: `status=${structuralReport.status}, metricsBasis=${structuralReport.metricsBasis}, keepBaseline=${structuralReport.decisionInputs.keepBaseline}, eligible=${structuralReport.decisionInputs.promotionCandidateEligible}`,
      result:
        structuralReport.status === 'EVIDENCE_INSUFFICIENT'
        && structuralReport.decisionInputs.keepBaseline === true
        && structuralReport.decisionInputs.promotionCandidateEligible === false
          ? 'pass'
          : 'fail',
    },
  ];

  const undersized = summarizeLongSessionPairedEvaluation({
    manifest,
    rows: deriveLongSessionPairedStructuralRows(manifest).slice(0, PAIRED_TARGET_COUNT - 1),
    generatedAt: structuralReport.generatedAt,
  });
  cases.push({
    id: 'undersized-sample-blocked',
    input: `score only ${PAIRED_TARGET_COUNT - 1} of ${PAIRED_TARGET_COUNT} frozen pairs`,
    expected: 'the sample-size gate blocks promotion',
    observed: undersized.blockers.find((blocker) => blocker.startsWith('fewer than')) ?? 'no sample-size blocker',
    result:
      undersized.blockers.some((blocker) => blocker.startsWith('fewer than'))
      && undersized.decisionInputs.promotionCandidateEligible === false
        ? 'pass'
        : 'fail',
  });

  const tampered = structuredClone(manifest);
  const victim = tampered.cases[0];
  victim.mustPreserve = victim.mustPreserve.slice(0, victim.mustPreserve.length - 1);
  const tamperCheck = assertFrozenWorkload(tampered);
  cases.push({
    id: 'post-freeze-case-edit-invalidates-hash',
    input: 'drop one must-preserve fact from a frozen case after the hash was signed',
    expected: 'workload hash mismatch and a per-case input hash mismatch',
    observed: tamperCheck.blockers.join(' | ') || 'no blocker',
    result:
      tamperCheck.ok === false
      && tamperCheck.blockers.includes('workload hash mismatch after freeze')
      && tamperCheck.blockers.some((blocker) => blocker.startsWith('case input hash mismatch'))
        ? 'pass'
        : 'fail',
  });

  const relaxed = structuredClone(manifest);
  relaxed.metricBudget.nextActionTarget = 0.6;
  const relaxedCheck = assertFrozenWorkload(relaxed);
  cases.push({
    id: 'post-freeze-threshold-edit-invalidated',
    input: 'lower the next-action target after the freeze without a pre-measurement proposal',
    expected: 'budget change reported and frozen hash no longer matching',
    observed: relaxedCheck.blockers.join(' | ') || 'no blocker',
    result:
      relaxedCheck.blockers.includes('metric budget nextActionTarget changed')
      && relaxedCheck.blockers.includes('workload hash mismatch after freeze')
        ? 'pass'
        : 'fail',
  });

  const estimated = summarizeLongSessionPairedEvaluation({
    manifest,
    rows: liveProviderShapedRows(manifest, { costSource: 'character-estimate' }),
    generatedAt: structuralReport.generatedAt,
  });
  cases.push({
    id: 'character-estimate-is-not-cost-evidence',
    input: 'report a plausible 20% saving while marking the cost source as a character estimate',
    expected: 'the estimate is vetoed and the candidate stays ineligible',
    observed: `${estimated.status}; ${estimated.blockers.find((blocker) => blocker.includes('character-estimated cost')) ?? 'no veto'}`,
    result:
      estimated.qualityClaimAllowed === false
      && estimated.blockers.some((blocker) => blocker.includes('character-estimated cost'))
        ? 'pass'
        : 'fail',
  });

  const leaked = summarizeLongSessionPairedEvaluation({
    manifest,
    rows: liveProviderShapedRows(manifest, { injectForbidden: true }),
    generatedAt: structuralReport.generatedAt,
  });
  cases.push({
    id: 'forbidden-fact-reinjection-blocked',
    input: 'a live-shaped candidate output re-injects a pending, unverified, revoked or out-of-scope fact',
    expected: 'candidate leak count above zero and the safety gate blocking promotion',
    observed: `candidateLeaks=${leaked.metrics.candidateRevokedLeaks}, eligible=${leaked.decisionInputs.promotionCandidateEligible}`,
    result:
      leaked.metrics.candidateRevokedLeaks > 0
      && leaked.decisionInputs.promotionCandidateEligible === false
        ? 'pass'
        : 'fail',
  });

  const falseDone = summarizeLongSessionPairedEvaluation({
    manifest,
    rows: liveProviderShapedRows(manifest, { falseCompletion: true }),
    generatedAt: structuralReport.generatedAt,
  });
  cases.push({
    id: 'false-completion-claim-blocked',
    input: 'a live-shaped candidate output claims the long-session program is complete',
    expected: 'false-completion count above zero and the safety gate blocking promotion',
    observed: `falseCompletions=${falseDone.metrics.candidateFalseCompletions}, eligible=${falseDone.decisionInputs.promotionCandidateEligible}`,
    result:
      falseDone.metrics.candidateFalseCompletions > 0
      && falseDone.decisionInputs.promotionCandidateEligible === false
        ? 'pass'
        : 'fail',
  });

  const stranger = deriveLongSessionPairedStructuralRows(manifest);
  stranger[stranger.length - 1] = { ...stranger[stranger.length - 1], caseId: 'd2-not-in-manifest' };
  const strangerReport = summarizeLongSessionPairedEvaluation({
    manifest,
    rows: stranger,
    generatedAt: structuralReport.generatedAt,
  });
  cases.push({
    id: 'measurement-outside-frozen-workload',
    input: 'submit a measurement row whose case id is not present in the frozen manifest',
    expected: 'the row is excluded from the aggregates and the run is blocked',
    observed: `samplePairs=${strangerReport.samplePairs}, ${strangerReport.blockers.find((blocker) => blocker.includes('outside the frozen workload')) ?? 'no exclusion blocker'}`,
    result:
      strangerReport.samplePairs === PAIRED_TARGET_COUNT - 1
      && strangerReport.blockers.some((blocker) => blocker.includes('outside the frozen workload'))
        ? 'pass'
        : 'fail',
  });

  return cases;
}
function retentionInventory(files) {
  return {
    schema: 'clawx.long-session.d2-retention/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    directory: DEFAULT_OUT,
    files,
    policy: 'Exact curated D2 evidence only. Raw gate logs stay under D:/tmp and are referenced, never committed.',
  };
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

function buildArtifacts() {
  const candidate = candidateIdentity();
  const provider = providerAvailability();
  const manifest = buildLongSessionPairedWorkload(ACTOR);
  const freeze = assertFrozenWorkload(manifest);
  if (!freeze.ok) throw new Error(`frozen workload invalid: ${freeze.blockers.join('; ')}`);
  if (manifest.workloadCount < PAIRED_TARGET_COUNT) throw new Error('frozen workload is shorter than the contract minimum');

  const rows = deriveLongSessionPairedStructuralRows(manifest, { model: 'frozen-paired-evaluation-model' });
  const structuralReport = summarizeLongSessionPairedEvaluation({
    manifest,
    rows,
    actor: ACTOR,
    generatedAt: new Date().toISOString(),
  });
  const negativeCases = [...structuralNegativeCases(manifest), ...detectionNegativeCases(manifest, structuralReport)];
  const report = summarizeLongSessionPairedEvaluation({
    manifest,
    rows,
    actor: ACTOR,
    generatedAt: structuralReport.generatedAt,
    negativeCases,
  });

  const manifestArtifact = {
    schema: PAIRED_WORKLOAD_SCHEMA,
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0557',
    program: 'long-session-development-20261022',
    contract: 'harness/specs/tasks/long-session-paired-evaluation.md',
    frozenAt: PAIRED_FREEZE_EPOCH,
    generatedAt: new Date().toISOString(),
    candidate,
    workloadHash: manifest.workloadHash,
    recomputedHash: freeze.recomputedHash,
    familyOrder: PAIRED_WORKLOAD_FAMILIES,
    providerProbe: provider,
    manifest,
    freezeChecks: {
      ok: freeze.ok,
      blockers: freeze.blockers,
      pairCount: manifest.workloadCount,
      families: manifest.families,
      requiredMetricBudget: manifest.metricBudget,
      sharedModelParameters: manifest.modelParameters,
    },
    limitations: [
      'The workload is a frozen agent-driven evaluation contract, not a claim that any provider ran it.',
      'must-preserve facts are synthetic per-case identities; they exercise the owner boundary, they are not user data.',
      'No real-human evidence is claimed.',
    ],
  };

  const reportArtifact = {
    schema: 'clawx.long-session.d2-report/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0557',
    generatedAt: new Date().toISOString(),
    candidate,
    providerProbe: provider,
    evaluation: report,
    rows,
    measurementSemantics: {
      nullMeaning: 'a cell is null only when it was never measured; it is never zero and never a character estimate',
      costSources: ['provider-report', 'character-estimate (rejected as evidence)', 'unmeasured'],
      agentDerivedScope: 'structural projection boundary only: fidelity, next-action, false completion and forbidden-fact exclusion',
    },
    limitations: [
      'No authorized live-provider endpoint is configured in this environment, so token/cache/cost and latency cells are unmeasured.',
      'Fidelity figures in this run are agent-derived structural checks, not model-quality measurements.',
      'No promotion, default change or product-lock decision is taken here; D3 consumes these inputs.',
    ],
  };

  const decisionArtifact = {
    schema: 'clawx.long-session.d2-decision-inputs/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0557',
    generatedAt: new Date().toISOString(),
    candidate,
    workloadHash: manifest.workloadHash,
    candidateIdentity: PAIRED_CANDIDATE_IDENTITY,
    status: report.status,
    disposition: report.decisionInputs.disposition,
    metricsBasis: report.metricsBasis,
    promotionCandidateEligible: report.decisionInputs.promotionCandidateEligible,
    keepBaseline: report.decisionInputs.keepBaseline,
    qualityClaimAllowed: report.qualityClaimAllowed,
    productDefaultChanged: false,
    blockers: report.blockers,
    unmeasured: report.unmeasured,
    requiresPublisherDecision: report.decisionInputs.requiresPublisherDecision,
    negativeCases: report.negativeCases,
    counts: {
      pairs: report.samplePairs,
      requiredPairs: report.requiredPairs,
      families: PAIRED_WORKLOAD_FAMILIES.length,
      negativeCases: report.negativeCases.length,
      failedNegativeCases: report.negativeCases.filter((entry) => entry.result === 'fail').length,
      unmeasuredTokenCells: report.metrics.unmeasuredTokenCells,
      unmeasuredLatencyCells: report.metrics.unmeasuredLatencyCells,
    },
    cleanup: {
      startedProcesses: false,
      startedGateway: false,
      startedElectron: false,
      providerRequests: 0,
      recoveryRequired: false,
      notes: 'Deterministic local generation only; no provider request, browser, Gateway or Electron process was launched.',
    },
    historicalBoundary: {
      tf0424VerdictReused: false,
      tf0424Note: 'TF-0424 keeps its own historical NO-GO identity; this D2 candidate has a new workload hash and is not a re-signing.',
      frozenDefaultsTouched: false,
    },
    nextNode: {
      id: 'TF-0558',
      taskKey: 'D3',
      contract: 'harness/specs/tasks/long-session-continuity-decision.md',
      allowedDecisions: ['keep-baseline', 'retain-experiment', 'scoped-opt-in'],
      guidance: 'Read this artifact from disk; keep-baseline/NO-GO is a valid closure and does not require async compression.',
    },
  };

  return { manifestArtifact, reportArtifact, decisionArtifact, report, manifest, provider };
}

/**
 * Optional raw gate receipt produced by the node's gate runner
 * (`{ gates: [{ name, exitCode, durationMs, log, summary? }] }`). It is
 * referenced, not re-signed: the raw logs stay outside Git.
 */
function readGateReceipt() {
  const gatePath = argValue('--gates');
  if (!gatePath) return { provided: false, gates: [], note: 'no gate receipt was supplied to this run' };
  const file = resolve(gatePath);
  if (!existsSync(file)) return { provided: false, gates: [], note: `gate receipt not found at ${file}` };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const gates = Array.isArray(parsed.gates) ? parsed.gates : [];
    if (gates.length === 0) return { provided: false, gates: [], note: 'gate receipt contained no gates' };
    return {
      provided: true,
      source: file.replaceAll('\\', '/'),
      candidate: parsed.candidate ?? null,
      allPassed: gates.every((gate) => gate.exitCode === 0),
      gates,
    };
  } catch (error) {
    return { provided: false, gates: [], note: `gate receipt unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const outDir = resolve(ROOT, argValue('--out', DEFAULT_OUT));
  const { manifestArtifact, reportArtifact, decisionArtifact, report, provider } = buildArtifacts();
  const candidate = candidateIdentity();
  const gateReceipt = readGateReceipt();

  const receipt = {
    schema: 'clawx.long-session.d2-verification/v1',
    drivenBy: 'agent',
    actor: ACTOR,
    taskForestNode: 'TF-0557',
    taskKey: 'D2',
    program: 'long-session-development-20261022',
    contract: 'harness/specs/tasks/long-session-paired-evaluation.md',
    generatedAt: new Date().toISOString(),
    candidate,
    workloadHash: manifestArtifact.workloadHash,
    providerProbe: provider,
    gateReceipt,
    verdict: report.status,
    featureClaim:
      'a frozen 30-pair agent-driven evaluation harness with fail-closed promotion gates exists; no continuity-strategy benefit is claimed',
    acceptance: [
      {
        criterion: 'freeze >=30 agent-driven pairs with must-preserve facts and metric budget before measurement, covering compression/handoff/fork/restart/revocation, one shared model parameter block',
        result: 'pass',
        evidence: [MANIFEST_FILE],
      },
      {
        criterion: 'fidelity 100%, false completions 0, next-action >= 95%, real token/cache/cost and first-token/wall-clock P50/P95 recorded without character estimates',
        result: provider.liveProviderAuthorized ? 'measured' : 'not-measurable',
        evidence: [REPORT_FILE],
        note: provider.liveProviderAuthorized
          ? 'live-provider sample present; gates evaluated from reported usage'
          : 'no authorized live-provider endpoint: cells stay null and the candidate is not eligible',
      },
      {
        criterion: 'promotion gate: >=15% cost or input-token reduction, P95 within 1.10x baseline, zero safety regression; thresholds only movable by a pre-measurement proposal',
        result: 'pass',
        evidence: [MANIFEST_FILE, REPORT_FILE],
        note: 'thresholds are validated inside the frozen workload hash; any edit invalidates the hash',
      },
      {
        criterion: 'without authorized live provider or sufficient quality/cost samples, output evidenceInsufficient/NO-GO and complete decision inputs; never promote on simulated data',
        result: 'pass',
        evidence: [DECISION_FILE],
      },
    ],
    results: {
      status: report.status,
      samplePairs: report.samplePairs,
      requiredPairs: report.requiredPairs,
      liveProviderEvidence: report.liveProviderEvidence,
      metricsBasis: report.metricsBasis,
      qualityClaimAllowed: report.qualityClaimAllowed,
      blockers: report.blockers,
      unmeasured: report.unmeasured,
      metrics: report.metrics,
      negativeCaseCounts: {
        total: report.negativeCases.length,
        failed: report.negativeCases.filter((entry) => entry.result === 'fail').length,
      },
    },
    commands: gateReceipt.provided
      ? gateReceipt.gates.map((gate) => ({ name: gate.name, exitCode: gate.exitCode, durationMs: gate.durationMs, log: gate.log, summary: gate.summary }))
      : [],
    counts: {
      gates: gateReceipt.gates.length,
      failedGates: gateReceipt.gates.filter((gate) => gate.exitCode !== 0).length,
      frozenPairs: report.samplePairs,
      negativeCases: report.negativeCases.length,
      failedNegativeCases: report.negativeCases.filter((entry) => entry.result === 'fail').length,
    },
    cleanup: {
      startedProcesses: false,
      startedGateway: false,
      startedElectron: false,
      providerRequests: 0,
      temporaryRoot: 'D:/tmp',
      recoveryRequired: false,
      notes: 'Local deterministic generation; raw gate logs live outside Git under D:/tmp and are referenced by path only.',
    },
    limitations: [
      'D2 delivers the frozen evaluation harness and its honest NO-GO decision inputs; it does not run a live provider in this environment.',
      'No product default, frozen lock, publication scope or independent Project decision is made or implied by this node.',
      'All evidence is agent-driven; no real-human verdict or human data is claimed.',
    ],
    artifacts: [MANIFEST_FILE, REPORT_FILE, DECISION_FILE, README_FILE, RECEIPT_FILE, 'SHA256SUMS'],
  };

  const readme = [
    '# D2 paired continuity evaluation evidence',
    '',
    `Source candidate: \`${candidate.commit || 'uncommitted'}\` (branch \`${candidate.branch}\`, tree \`${candidate.tree || 'n/a'}\`).`,
    `Frozen workload hash: \`${manifestArtifact.workloadHash}\`.`,
    '',
    `- \`${MANIFEST_FILE}\`: the pre-measurement frozen ${manifestArtifact.manifest.workloadCount}-pair agent-driven workload (6 pairs per family across compression, handoff, fork, restart, revocation), its must-preserve facts, forbidden facts, shared model parameters and metric budget, plus the freeze verification result.`,
    `- \`${REPORT_FILE}\`: fidelity, next-action, false-completion, revoked-leak, token/cache/cost and first-token/wall-clock P50/P95 report with per-cell null meaning "not measured"; this run has no authorized live-provider sample, so the status is \`${report.status}\`.`,
    `- \`${DECISION_FILE}\`: D3 decision inputs: keep-baseline/NO-GO disposition, blockers, unmeasured scope, negative cases, cleanup and the explicit statement that no product default changed.`,
    `- \`${RECEIPT_FILE}\`: candidate identity, provider probe, acceptance mapping, counts, cleanup and honest limitations.`,
    '',
    'Every action here is agent-driven (`driven_by: agent`, `actor: codex-long-session-d2`). No real-human operation, verdict or data is claimed,',
    'and no simulated-provider measurement is presented as evidence of a quality or cost win.',
    '',
  ].join('\n');

  if (checkOnly) {
    const failures = [];
    const recomputed = buildArtifacts();
    const negativeKey = (entry) => entry.id + ':' + entry.result;

    /** Frozen contract facts. Candidate metadata is deliberately excluded. */
    const stableProjection = (kind, value) => {
      if (kind === MANIFEST_FILE) {
        return {
          workloadHash: value.workloadHash,
          recomputedHash: value.recomputedHash,
          schema: value.manifest.schema,
          version: value.manifest.version,
          pairCount: value.manifest.workloadCount,
          families: value.manifest.families,
          metricBudget: value.manifest.metricBudget,
          modelParameters: value.manifest.modelParameters,
          caseInputHashes: value.manifest.cases.map((entry) => entry.inputHash),
          candidateProjectionHashes: value.manifest.cases.map((entry) =>
            hashText(renderLongSessionPairedCandidateInput(entry.candidateArtifact)),
          ),
        };
      }
      if (kind === REPORT_FILE) {
        return {
          workloadHash: value.evaluation.workloadHash,
          status: value.evaluation.status,
          metricsBasis: value.evaluation.metricsBasis,
          samplePairs: value.evaluation.samplePairs,
          liveProviderEvidence: value.evaluation.liveProviderEvidence,
          qualityClaimAllowed: value.evaluation.qualityClaimAllowed,
          metrics: value.evaluation.metrics,
          negativeCases: value.evaluation.negativeCases.map(negativeKey),
          failedNegativeCases: value.evaluation.negativeCases.filter((entry) => entry.result === 'fail').length,
        };
      }
      return {
        workloadHash: value.workloadHash,
        status: value.status,
        disposition: value.disposition,
        metricsBasis: value.metricsBasis,
        keepBaseline: value.keepBaseline,
        promotionCandidateEligible: value.promotionCandidateEligible,
        qualityClaimAllowed: value.qualityClaimAllowed,
        productDefaultChanged: value.productDefaultChanged,
        blockers: value.blockers,
        pairs: value.counts.pairs,
        failedNegativeCases: value.counts.failedNegativeCases,
      };
    };

    for (const [name, value] of [
      [MANIFEST_FILE, recomputed.manifestArtifact],
      [REPORT_FILE, recomputed.reportArtifact],
      [DECISION_FILE, recomputed.decisionArtifact],
    ]) {
      const file = join(outDir, name);
      if (!existsSync(file)) {
        failures.push(name + ': missing');
        continue;
      }
      const committed = JSON.parse(readFileSync(file, 'utf8'));
      if (JSON.stringify(stableProjection(name, committed)) !== JSON.stringify(stableProjection(name, value))) {
        failures.push(name + ': frozen-contract projection drifted');
      }
    }

    const sumsFile = join(outDir, 'SHA256SUMS');
    if (existsSync(sumsFile)) {
      for (const line of readFileSync(sumsFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        const expected = parts[0];
        const name = parts[1];
        const file = join(outDir, name);
        if (!existsSync(file)) failures.push('SHA256SUMS: ' + name + ' missing');
        else if (sha256File(file) !== expected) failures.push('SHA256SUMS: ' + name + ' digest drift');
      }
    } else {
      failures.push('SHA256SUMS: missing');
    }
    console.log(JSON.stringify({ checkOnly: true, ok: failures.length === 0, failures, workloadHash: recomputed.manifestArtifact.workloadHash }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
    return;
  }
  mkdirSync(outDir, { recursive: true });
  writeJson(join(outDir, MANIFEST_FILE), manifestArtifact);
  writeJson(join(outDir, REPORT_FILE), reportArtifact);
  writeJson(join(outDir, DECISION_FILE), decisionArtifact);
  writeJson(join(outDir, RECEIPT_FILE), receipt);
  writeFileSync(join(outDir, README_FILE), readme, 'utf8');

  const evidenceFiles = readdirSync(outDir)
    .filter((name) => name !== 'SHA256SUMS' && !name.startsWith('.') && name !== 'gates.json')
    .sort();
  const sums = evidenceFiles.map((name) => `${sha256File(join(outDir, name))}  ${name}\n`).join('');
  writeFileSync(join(outDir, 'SHA256SUMS'), sums, 'utf8');

  const secretMatches = scanSecrets(evidenceFiles.map((name) => join(outDir, name)));
  if (secretMatches.length > 0) {
    for (const file of evidenceFiles) rmSync(join(outDir, file), { force: true });
    throw new Error(`D2 evidence contains credential-like patterns: ${JSON.stringify(secretMatches)}`);
  }

  const readback = {};
  for (const name of evidenceFiles) {
    const file = join(outDir, name);
    const text = readFileSync(file, 'utf8');
    readback[name] = { bytes: Buffer.byteLength(text), sha256: sha256File(file), parsed: name.endsWith('.json') ? Boolean(JSON.parse(text)) : null };
  }

  console.log(JSON.stringify({
    outDir,
    workloadHash: manifestArtifact.workloadHash,
    status: report.status,
    disposition: report.decisionInputs.disposition,
    metricsBasis: report.metricsBasis,
    keepBaseline: report.decisionInputs.keepBaseline,
    evidenceFiles,
    readback,
    retention: retentionInventory(evidenceFiles),
  }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main();
}